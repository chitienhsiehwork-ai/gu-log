#!/usr/bin/env python3
"""Fail-closed snapshots for Tribunal writer edits to one bilingual post pair."""

from __future__ import annotations

import argparse
import base64
import binascii
import ctypes
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SNAPSHOT_PREFIX = "tribunal-rewrite."
SNAPSHOT_FILES = frozenset({"meta.json", "zh", "en"})
TOKEN_VERSION = 1
APPLY_JOURNAL_PREFIX = ".tribunal-pair-journal-"
APPLY_JOURNAL_SUFFIX = ".json"
APPLY_JOURNAL_VERSION = 1
READ_CHUNK_SIZE = 1024 * 1024
MAX_CANDIDATE_FILE_BYTES = 2 * 1024 * 1024
MAX_JOURNAL_PAYLOAD_BYTES = 8 * 1024 * 1024
MAX_JOURNAL_FILE_BYTES = 32 * 1024 * 1024
MAX_RECOVERY_SCAN_ENTRIES = 16 * 1024
RENAME_EXCHANGE = 2


class SnapshotError(RuntimeError):
    """The snapshot or target failed a safety/postcondition check."""


@dataclass(frozen=True)
class SnapshotToken:
    path: str
    digest: str
    meta_bytes: bytes
    zh_bytes: bytes
    en_bytes: bytes | None


@dataclass(frozen=True)
class JournalFileState:
    payload: bytes
    mode: int
    identity: tuple[int, int]


@dataclass(frozen=True)
class JournalMember:
    canonical_name: str
    temp_name: str
    baseline: JournalFileState
    candidate: JournalFileState


@dataclass(frozen=True)
class ApplyJournal:
    parent_identity: tuple[int, int]
    zh_name: str
    members: tuple[JournalMember, ...]


def _open_dir_nofollow(path: str) -> int:
    candidate = Path(path)
    if not candidate.is_absolute():
        raise SnapshotError(f"directory path must be absolute: {path}")

    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open("/", flags)
    try:
        for component in candidate.parts[1:]:
            next_fd = os.open(component, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise


def _canonical_directory(path: str) -> tuple[str, os.stat_result]:
    canonical = os.path.realpath(path)
    fd = _open_dir_nofollow(canonical)
    try:
        return canonical, os.fstat(fd)
    finally:
        os.close(fd)


def _fsync_directory(directory_fd: int) -> None:
    try:
        os.fsync(directory_fd)
    except OSError as error:
        if error.errno not in {errno.EINVAL, errno.ENOTSUP}:
            raise


def _file_fingerprint(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
        stat.S_IMODE(info.st_mode),
    )


def _file_identity(info: os.stat_result) -> tuple[int, int]:
    return (info.st_dev, info.st_ino)


def _read_regular_file_state(
    directory_fd: int,
    name: str,
    *,
    require_single_link: bool = False,
    max_bytes: int | None = None,
) -> tuple[bytes, int, tuple[int, ...]]:
    if "/" in name or name in {"", ".", ".."}:
        raise SnapshotError(f"invalid fixed snapshot filename: {name!r}")

    # O_NONBLOCK makes special-file substitution fail boundedly: opening a
    # FIFO read-only would otherwise hang before fstat can reject its type.
    fd = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        dir_fd=directory_fd,
    )
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise SnapshotError(f"not a regular file: {name}")
        if require_single_link and before.st_nlink != 1:
            raise SnapshotError(f"candidate file has unsafe link count: {name}")
        if max_bytes is not None and before.st_size > max_bytes:
            raise SnapshotError(f"candidate file exceeds byte limit: {name}")

        chunks: list[bytes] = []
        total_bytes = 0
        while True:
            chunk = os.read(fd, READ_CHUNK_SIZE)
            if not chunk:
                break
            total_bytes += len(chunk)
            if max_bytes is not None and total_bytes > max_bytes:
                raise SnapshotError(f"candidate file exceeds byte limit: {name}")
            chunks.append(chunk)

        after = os.fstat(fd)
        if _file_fingerprint(before) != _file_fingerprint(after):
            raise SnapshotError(f"file changed while being read: {name}")
        if require_single_link and after.st_nlink != 1:
            raise SnapshotError(f"candidate file link count changed: {name}")
        return (
            b"".join(chunks),
            stat.S_IMODE(before.st_mode),
            _file_fingerprint(after),
        )
    finally:
        os.close(fd)


def _read_regular_file(
    directory_fd: int,
    name: str,
    *,
    require_single_link: bool = False,
    max_bytes: int | None = None,
) -> tuple[bytes, int]:
    payload, mode, _ = _read_regular_file_state(
        directory_fd,
        name,
        require_single_link=require_single_link,
        max_bytes=max_bytes,
    )
    return payload, mode


def _read_open_regular_file(fd: int, name: str) -> tuple[bytes, os.stat_result]:
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):
        raise SnapshotError(f"not a regular file: {name}")

    chunks: list[bytes] = []
    while True:
        chunk = os.read(fd, READ_CHUNK_SIZE)
        if not chunk:
            break
        chunks.append(chunk)

    after = os.fstat(fd)
    if _file_fingerprint(before) != _file_fingerprint(after):
        raise SnapshotError(f"file changed while being read: {name}")
    return b"".join(chunks), after


def _lstat_optional(directory_fd: int, name: str) -> os.stat_result | None:
    try:
        return os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


def _require_regular_or_absent(directory_fd: int, name: str) -> os.stat_result | None:
    info = _lstat_optional(directory_fd, name)
    if info is not None and not stat.S_ISREG(info.st_mode):
        raise SnapshotError(f"unsafe non-regular target: {name}")
    return info


def _bounded_directory_names(
    directory_fd: int,
    allowed_names: frozenset[str] | set[str],
    *,
    require_exact: bool,
    label: str,
) -> set[str]:
    """Read only an allowlisted directory shape without materializing entry bombs."""
    seen: set[str] = set()
    with os.scandir(directory_fd) as entries:
        for entry in entries:
            name = entry.name
            if name not in allowed_names:
                raise SnapshotError(f"{label} contains an unexpected entry")
            seen.add(name)
    if require_exact and seen != set(allowed_names):
        raise SnapshotError(f"{label} has missing entries")
    return seen


def _write_all(fd: int, payload: bytes) -> None:
    view = memoryview(payload)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise SnapshotError("short write while preparing snapshot restore")
        view = view[written:]


def _write_new_file(
    directory_fd: int, name: str, payload: bytes, mode: int
) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(name, flags, 0o600, dir_fd=directory_fd)
    try:
        _write_all(fd, payload)
        os.fchmod(fd, mode)
        os.fsync(fd)
    except Exception:
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


def _payload_digest(meta_bytes: bytes, zh_bytes: bytes, en_bytes: bytes | None) -> str:
    digest = hashlib.sha256()
    digest.update(b"gu-log-tribunal-post-pair-v1\0")
    for payload in (meta_bytes, zh_bytes, en_bytes if en_bytes is not None else b""):
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def _canonical_meta(
    en_present: bool,
    zh_mode: int,
    en_mode: int | None,
    zh_name: str,
    parent_info: os.stat_result,
) -> bytes:
    meta = {
        "en_mode": en_mode,
        "en_present": en_present,
        "parent_dev": parent_info.st_dev,
        "parent_ino": parent_info.st_ino,
        "version": TOKEN_VERSION,
        "zh_mode": zh_mode,
        "zh_name": zh_name,
    }
    return json.dumps(meta, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _parse_meta(meta_bytes: bytes) -> dict[str, Any]:
    try:
        meta = json.loads(meta_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError("snapshot metadata is invalid") from error
    if not isinstance(meta, dict) or set(meta) != {
        "en_mode",
        "en_present",
        "parent_dev",
        "parent_ino",
        "version",
        "zh_mode",
        "zh_name",
    }:
        raise SnapshotError("snapshot metadata shape is invalid")
    if meta["version"] != TOKEN_VERSION or not isinstance(meta["en_present"], bool):
        raise SnapshotError("snapshot metadata version/state is invalid")
    for key in ("zh_mode", "en_mode"):
        value = meta[key]
        if key == "en_mode" and not meta["en_present"] and value is None:
            continue
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 0
            or value > 0o777
        ):
            raise SnapshotError(f"snapshot {key} is invalid")
    if meta["en_present"] != (meta["en_mode"] is not None):
        raise SnapshotError("snapshot English state/mode disagree")
    if (
        not isinstance(meta["zh_name"], str)
        or meta["zh_name"] in {"", ".", ".."}
        or "/" in meta["zh_name"]
    ):
        raise SnapshotError("snapshot target filename is invalid")
    for key in ("parent_dev", "parent_ino"):
        value = meta[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise SnapshotError(f"snapshot {key} is invalid")
    return meta


def _encode_bytes(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


def _decode_bytes(value: Any, label: str) -> bytes:
    if not isinstance(value, str):
        raise SnapshotError(f"snapshot token {label} payload is invalid")
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise SnapshotError(f"snapshot token {label} payload is invalid") from error


def _frontmatter_bytes(payload: bytes, label: str) -> bytes:
    match = re.match(
        br"\A---\r?\n[\s\S]*?\r?\n---(?:\r?\n|\Z)",
        payload,
    )
    if match is None:
        raise SnapshotError(f"{label} has invalid or missing frontmatter")
    return match.group(0)


def _encode_token(
    snapshot_dir: str,
    digest: str,
    meta_bytes: bytes,
    zh_bytes: bytes,
    en_bytes: bytes | None,
) -> str:
    return json.dumps(
        {
            "digest": digest,
            "en": _encode_bytes(en_bytes) if en_bytes is not None else None,
            "meta": _encode_bytes(meta_bytes),
            "path": snapshot_dir,
            "version": TOKEN_VERSION,
            "zh": _encode_bytes(zh_bytes),
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def _parse_token(token: str) -> SnapshotToken:
    try:
        value = json.loads(token)
    except json.JSONDecodeError as error:
        raise SnapshotError("snapshot token is invalid") from error
    if (
        not isinstance(value, dict)
        or set(value) != {"digest", "en", "meta", "path", "version", "zh"}
        or value["version"] != TOKEN_VERSION
        or not isinstance(value["path"], str)
        or not Path(value["path"]).is_absolute()
        or not isinstance(value["digest"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", value["digest"])
    ):
        raise SnapshotError("snapshot token shape is invalid")
    if not Path(value["path"]).name.startswith(SNAPSHOT_PREFIX):
        raise SnapshotError("snapshot token path is outside the expected namespace")
    meta_bytes = _decode_bytes(value["meta"], "metadata")
    zh_bytes = _decode_bytes(value["zh"], "zh-tw")
    en_bytes = (
        None if value["en"] is None else _decode_bytes(value["en"], "English")
    )
    meta = _parse_meta(meta_bytes)
    if meta["en_present"] != (en_bytes is not None):
        raise SnapshotError("snapshot token English state disagrees with metadata")
    actual_digest = _payload_digest(meta_bytes, zh_bytes, en_bytes)
    if not hmac.compare_digest(actual_digest, value["digest"]):
        raise SnapshotError("snapshot token integrity digest mismatch")
    return SnapshotToken(
        path=value["path"],
        digest=value["digest"],
        meta_bytes=meta_bytes,
        zh_bytes=zh_bytes,
        en_bytes=en_bytes,
    )


def _snapshot_payload(
    snapshot_dir: str, expected_digest: str
) -> tuple[dict[str, Any], bytes, bytes | None]:
    snapshot_fd = _open_dir_nofollow(snapshot_dir)
    try:
        meta_bytes, _ = _read_regular_file(snapshot_fd, "meta.json")
        meta = _parse_meta(meta_bytes)
        expected_names = {"meta.json", "zh"}
        if meta["en_present"]:
            expected_names.add("en")
        _bounded_directory_names(
            snapshot_fd,
            expected_names,
            require_exact=True,
            label="snapshot",
        )

        zh_bytes, zh_mode = _read_regular_file(snapshot_fd, "zh")
        if zh_mode != meta["zh_mode"]:
            raise SnapshotError("snapshot zh-tw mode disagrees with metadata")

        en_bytes: bytes | None = None
        if meta["en_present"]:
            en_bytes, en_mode = _read_regular_file(snapshot_fd, "en")
            if en_mode != meta["en_mode"]:
                raise SnapshotError("snapshot English mode disagrees with metadata")

        actual_digest = _payload_digest(meta_bytes, zh_bytes, en_bytes)
        if not hmac.compare_digest(actual_digest, expected_digest):
            raise SnapshotError("snapshot integrity digest mismatch")
        return meta, zh_bytes, en_bytes
    finally:
        os.close(snapshot_fd)


def _cleanup_created_snapshot(snapshot_dir: str) -> None:
    try:
        snapshot_fd = _open_dir_nofollow(snapshot_dir)
    except (OSError, SnapshotError):
        return
    try:
        for name in SNAPSHOT_FILES:
            try:
                os.unlink(name, dir_fd=snapshot_fd)
            except FileNotFoundError:
                pass
            except OSError:
                return
    finally:
        os.close(snapshot_fd)
    try:
        os.rmdir(snapshot_dir)
    except OSError:
        pass


def create_snapshot(zh_path: str) -> str:
    target = Path(zh_path)
    if not target.is_absolute():
        raise SnapshotError(f"post path must be absolute: {zh_path}")

    canonical_parent, parent_info = _canonical_directory(str(target.parent))
    parent_fd = _open_dir_nofollow(canonical_parent)
    try:
        zh_bytes, zh_mode = _read_regular_file(parent_fd, target.name)
        if zh_mode > 0o777:
            raise SnapshotError("zh-tw post has unsupported special permission bits")

        en_name = f"en-{target.name}"
        en_bytes: bytes | None = None
        en_mode: int | None = None
        en_info = _lstat_optional(parent_fd, en_name)
        if en_info is not None:
            if not stat.S_ISREG(en_info.st_mode):
                raise SnapshotError("English post is not a safe regular file")
            en_bytes, en_mode = _read_regular_file(parent_fd, en_name)
            if en_mode > 0o777:
                raise SnapshotError("English post has unsupported special permission bits")
    finally:
        os.close(parent_fd)

    meta_bytes = _canonical_meta(
        en_bytes is not None, zh_mode, en_mode, target.name, parent_info
    )
    digest = _payload_digest(meta_bytes, zh_bytes, en_bytes)
    canonical_tmp, _ = _canonical_directory(os.environ.get("TMPDIR") or "/tmp")
    snapshot_dir = tempfile.mkdtemp(
        prefix=SNAPSHOT_PREFIX, dir=canonical_tmp
    )
    try:
        os.chmod(snapshot_dir, 0o700)
        snapshot_fd = _open_dir_nofollow(snapshot_dir)
        try:
            _write_new_file(snapshot_fd, "meta.json", meta_bytes, 0o600)
            _write_new_file(snapshot_fd, "zh", zh_bytes, zh_mode)
            if en_bytes is not None and en_mode is not None:
                _write_new_file(snapshot_fd, "en", en_bytes, en_mode)
            _fsync_directory(snapshot_fd)
        finally:
            os.close(snapshot_fd)
    except Exception:
        _cleanup_created_snapshot(snapshot_dir)
        raise
    return _encode_token(snapshot_dir, digest, meta_bytes, zh_bytes, en_bytes)


def _prepare_restore_file(
    directory_fd: int, label: str, payload: bytes, mode: int
) -> str:
    for _ in range(32):
        name = f".tribunal-restore-{label}-{secrets.token_hex(12)}"
        try:
            _write_new_file(directory_fd, name, payload, mode)
            return name
        except FileExistsError:
            continue
    raise SnapshotError("could not allocate a collision-free restore file")


def _rename_exchange(directory_fd: int, first_name: str, second_name: str) -> None:
    """Atomically exchange two same-directory paths on the deployed Linux runtime."""
    if not sys.platform.startswith("linux"):
        raise SnapshotError(
            "atomic candidate compare-and-swap requires Linux renameat2"
        )
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise SnapshotError("Linux libc does not expose renameat2")
    renameat2.argtypes = (
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    )
    renameat2.restype = ctypes.c_int
    result = renameat2(
        directory_fd,
        os.fsencode(first_name),
        directory_fd,
        os.fsencode(second_name),
        RENAME_EXCHANGE,
    )
    if result != 0:
        error_number = ctypes.get_errno()
        raise SnapshotError(
            "atomic candidate path exchange failed: "
            f"{os.strerror(error_number)}"
        )


def _path_payload_matches(
    directory_fd: int,
    name: str,
    payload: bytes,
    mode: int,
    identity: tuple[int, int] | None = None,
) -> bool:
    try:
        actual, actual_mode, actual_fingerprint = _read_regular_file_state(
            directory_fd, name
        )
    except (OSError, SnapshotError):
        return False
    return (
        actual == payload
        and actual_mode == mode
        and (
            identity is None
            or (actual_fingerprint[0], actual_fingerprint[1]) == identity
        )
    )


def _rollback_exchange_if_unchanged(
    directory_fd: int,
    canonical_name: str,
    displaced_name: str,
    candidate_payload: bytes,
    candidate_mode: int,
    candidate_identity: tuple[int, int],
) -> bool:
    """Restore the displaced path only while canonical still holds our candidate.

    The first exchange temporarily puts the displaced baseline back at the
    canonical path. If the path actually held a later parallel edit, the second
    exchange restores that edit and reports a conflict instead of overwriting it.
    """
    _rename_exchange(directory_fd, displaced_name, canonical_name)
    if _path_payload_matches(
        directory_fd,
        displaced_name,
        candidate_payload,
        candidate_mode,
        candidate_identity,
    ):
        return True
    _rename_exchange(directory_fd, displaced_name, canonical_name)
    return False


def _verify_pair_payload(
    parent_fd: int,
    zh_name: str,
    en_name: str,
    meta: dict[str, Any],
    zh_bytes: bytes,
    en_bytes: bytes | None,
    *,
    label: str,
) -> dict[str, tuple[int, int]]:
    zh_fd = os.open(
        zh_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        dir_fd=parent_fd,
    )
    en_fd: int | None = None
    try:
        if meta["en_present"]:
            if en_bytes is None:
                raise SnapshotError("internal English snapshot state mismatch")
            en_fd = os.open(
                en_name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=parent_fd,
            )

        actual_zh, zh_opened = _read_open_regular_file(zh_fd, zh_name)
        if actual_zh != zh_bytes or stat.S_IMODE(zh_opened.st_mode) != meta["zh_mode"]:
            raise SnapshotError(f"zh-tw {label} postcondition failed")

        en_opened: os.stat_result | None = None
        if en_fd is not None and en_bytes is not None:
            actual_en, en_opened = _read_open_regular_file(en_fd, en_name)
            if (
                actual_en != en_bytes
                or stat.S_IMODE(en_opened.st_mode) != meta["en_mode"]
            ):
                raise SnapshotError(f"English {label} postcondition failed")
        elif _lstat_optional(parent_fd, en_name) is not None:
            raise SnapshotError(f"originally absent English post exists after {label}")

        # Bind both pathnames to the descriptors opened before either payload
        # was read. This consistency check is not the writer security boundary:
        # isolated writer runs cannot write this canonical directory.
        identities: dict[str, tuple[int, int]] = {}
        for name, opened in ((zh_name, zh_opened), (en_name, en_opened)):
            if opened is None:
                continue
            linked = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            current_fd = zh_fd if name == zh_name else en_fd
            if current_fd is None:
                raise SnapshotError("internal pair descriptor state mismatch")
            current = os.fstat(current_fd)
            if (
                _file_fingerprint(opened) != _file_fingerprint(current)
                or _file_fingerprint(opened) != _file_fingerprint(linked)
            ):
                raise SnapshotError(f"{label} postcondition path changed: {name}")
            identities[name] = _file_identity(opened)
        return identities
    finally:
        if en_fd is not None:
            os.close(en_fd)
        os.close(zh_fd)


def _verify_restored_pair(
    parent_fd: int,
    zh_name: str,
    en_name: str,
    meta: dict[str, Any],
    zh_bytes: bytes,
    en_bytes: bytes | None,
) -> None:
    _verify_pair_payload(
        parent_fd,
        zh_name,
        en_name,
        meta,
        zh_bytes,
        en_bytes,
        label="restore",
    )


def _journal_name_for_target(zh_name: str) -> str:
    if zh_name in {"", ".", ".."} or "/" in zh_name:
        raise SnapshotError("apply journal target filename is invalid")
    digest = hashlib.sha256(zh_name.encode("utf-8")).hexdigest()
    return f"{APPLY_JOURNAL_PREFIX}{digest}{APPLY_JOURNAL_SUFFIX}"


def _journal_identity_value(
    value: Any, label: str
) -> tuple[int, int]:
    if not isinstance(value, dict) or set(value) != {"dev", "ino"}:
        raise SnapshotError(f"apply journal {label} identity is invalid")
    dev = value["dev"]
    ino = value["ino"]
    if (
        not isinstance(dev, int)
        or isinstance(dev, bool)
        or dev < 0
        or not isinstance(ino, int)
        or isinstance(ino, bool)
        or ino < 0
    ):
        raise SnapshotError(f"apply journal {label} identity is invalid")
    return (dev, ino)


def _journal_file_state_value(
    value: Any, label: str
) -> JournalFileState:
    if not isinstance(value, dict) or set(value) != {
        "bytes",
        "identity",
        "mode",
    }:
        raise SnapshotError(f"apply journal {label} state is invalid")
    mode = value["mode"]
    if (
        not isinstance(mode, int)
        or isinstance(mode, bool)
        or mode < 0
        or mode > 0o777
    ):
        raise SnapshotError(f"apply journal {label} mode is invalid")
    payload = _decode_bytes(value["bytes"], f"apply journal {label}")
    if len(payload) > MAX_JOURNAL_PAYLOAD_BYTES:
        raise SnapshotError(f"apply journal {label} payload exceeds byte limit")
    return JournalFileState(
        payload=payload,
        mode=mode,
        identity=_journal_identity_value(value["identity"], label),
    )


def _journal_file_state_json(state: JournalFileState) -> dict[str, Any]:
    if len(state.payload) > MAX_JOURNAL_PAYLOAD_BYTES:
        raise SnapshotError("apply journal payload exceeds byte limit")
    return {
        "bytes": _encode_bytes(state.payload),
        "identity": {
            "dev": state.identity[0],
            "ino": state.identity[1],
        },
        "mode": state.mode,
    }


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def _journal_digest(core: dict[str, Any]) -> str:
    digest = hashlib.sha256()
    digest.update(b"gu-log-tribunal-pair-apply-journal-v1\0")
    digest.update(_canonical_json(core))
    return digest.hexdigest()


def _encode_apply_journal(journal: ApplyJournal) -> bytes:
    core = {
        "members": [
            {
                "baseline": _journal_file_state_json(member.baseline),
                "candidate": _journal_file_state_json(member.candidate),
                "canonical_name": member.canonical_name,
                "temp_name": member.temp_name,
            }
            for member in journal.members
        ],
        "parent_dev": journal.parent_identity[0],
        "parent_ino": journal.parent_identity[1],
        "version": APPLY_JOURNAL_VERSION,
        "zh_name": journal.zh_name,
    }
    return _canonical_json({"digest": _journal_digest(core), **core})


def _parse_apply_journal(payload: bytes, journal_name: str) -> ApplyJournal:
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError("apply journal JSON is invalid") from error
    if not isinstance(value, dict) or set(value) != {
        "digest",
        "members",
        "parent_dev",
        "parent_ino",
        "version",
        "zh_name",
    }:
        raise SnapshotError("apply journal shape is invalid")
    if (
        value["version"] != APPLY_JOURNAL_VERSION
        or not isinstance(value["digest"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", value["digest"])
    ):
        raise SnapshotError("apply journal version/digest is invalid")
    core = {key: item for key, item in value.items() if key != "digest"}
    if not hmac.compare_digest(_journal_digest(core), value["digest"]):
        raise SnapshotError("apply journal integrity digest mismatch")

    zh_name = value["zh_name"]
    if (
        not isinstance(zh_name, str)
        or zh_name in {"", ".", ".."}
        or "/" in zh_name
        or journal_name != _journal_name_for_target(zh_name)
    ):
        raise SnapshotError("apply journal target/name binding is invalid")
    parent_identity = _journal_identity_value(
        {"dev": value["parent_dev"], "ino": value["parent_ino"]},
        "parent",
    )

    raw_members = value["members"]
    if not isinstance(raw_members, list) or len(raw_members) not in {1, 2}:
        raise SnapshotError("apply journal member list is invalid")
    members: list[JournalMember] = []
    canonical_names: set[str] = set()
    temp_names: set[str] = set()
    for index, raw_member in enumerate(raw_members):
        if not isinstance(raw_member, dict) or set(raw_member) != {
            "baseline",
            "candidate",
            "canonical_name",
            "temp_name",
        }:
            raise SnapshotError("apply journal member shape is invalid")
        canonical_name = raw_member["canonical_name"]
        temp_name = raw_member["temp_name"]
        if (
            not isinstance(canonical_name, str)
            or canonical_name in {"", ".", ".."}
            or "/" in canonical_name
            or not isinstance(temp_name, str)
            or not temp_name.startswith(".tribunal-restore-")
            or temp_name in {"", ".", ".."}
            or "/" in temp_name
        ):
            raise SnapshotError("apply journal member filename is invalid")
        if canonical_name in canonical_names or temp_name in temp_names:
            raise SnapshotError("apply journal contains duplicate member paths")
        canonical_names.add(canonical_name)
        temp_names.add(temp_name)
        members.append(
            JournalMember(
                canonical_name=canonical_name,
                temp_name=temp_name,
                baseline=_journal_file_state_value(
                    raw_member["baseline"], f"member {index} baseline"
                ),
                candidate=_journal_file_state_value(
                    raw_member["candidate"], f"member {index} candidate"
                ),
            )
        )
    expected_names = {zh_name}
    if len(members) == 2:
        expected_names.add(f"en-{zh_name}")
    if canonical_names != expected_names:
        raise SnapshotError("apply journal bilingual member set is invalid")
    return ApplyJournal(
        parent_identity=parent_identity,
        zh_name=zh_name,
        members=tuple(members),
    )


def _read_apply_journal(
    parent_fd: int, journal_name: str
) -> tuple[ApplyJournal, bytes, tuple[int, int]]:
    payload, mode, fingerprint = _read_regular_file_state(
        parent_fd,
        journal_name,
        require_single_link=True,
        max_bytes=MAX_JOURNAL_FILE_BYTES,
    )
    if mode != 0o600:
        raise SnapshotError("apply journal must have mode 600")
    return (
        _parse_apply_journal(payload, journal_name),
        payload,
        (fingerprint[0], fingerprint[1]),
    )


def _write_apply_journal(parent_fd: int, journal: ApplyJournal) -> str:
    journal_name = _journal_name_for_target(journal.zh_name)
    journal_payload = _encode_apply_journal(journal)
    if len(journal_payload) > MAX_JOURNAL_FILE_BYTES:
        raise SnapshotError("apply journal exceeds byte limit")
    try:
        _write_new_file(
            parent_fd,
            journal_name,
            journal_payload,
            0o600,
        )
    except FileExistsError as error:
        raise SnapshotError(
            f"pending apply journal requires recovery: {journal_name}"
        ) from error
    _fsync_directory(parent_fd)
    return journal_name


def _journal_path_state(
    parent_fd: int, name: str, member: JournalMember
) -> str:
    info = _lstat_optional(parent_fd, name)
    if info is None:
        return "absent"
    if not stat.S_ISREG(info.st_mode):
        return "unknown"
    if _path_payload_matches(
        parent_fd,
        name,
        member.baseline.payload,
        member.baseline.mode,
        member.baseline.identity,
    ):
        return "baseline"
    if _path_payload_matches(
        parent_fd,
        name,
        member.candidate.payload,
        member.candidate.mode,
        member.candidate.identity,
    ):
        return "candidate"
    return "unknown"


def _recover_apply_journal_fd(parent_fd: int, journal_name: str) -> str:
    journal, journal_payload, journal_identity = _read_apply_journal(
        parent_fd, journal_name
    )
    parent_info = os.fstat(parent_fd)
    if _file_identity(parent_info) != journal.parent_identity:
        raise SnapshotError("apply journal parent directory identity changed")

    states: list[tuple[JournalMember, str, str]] = []
    for member in journal.members:
        canonical_state = _journal_path_state(
            parent_fd, member.canonical_name, member
        )
        temp_state = _journal_path_state(parent_fd, member.temp_name, member)
        if canonical_state not in {"baseline", "candidate"}:
            raise SnapshotError(
                f"apply journal canonical path is unknown: {member.canonical_name}"
            )
        if temp_state == "unknown":
            raise SnapshotError(
                f"apply journal temp path is unknown: {member.temp_name}"
            )
        states.append((member, canonical_state, temp_state))

    canonical_states = {canonical_state for _, canonical_state, _ in states}
    if canonical_states == {"baseline"}:
        outcome = "baseline"
        expected_temp = "candidate"
        if any(
            temp_state not in {expected_temp, "absent"}
            for _, _, temp_state in states
        ):
            raise SnapshotError("baseline apply recovery has inconsistent temp state")
    elif canonical_states == {"candidate"}:
        outcome = "candidate"
        expected_temp = "baseline"
        if any(
            temp_state not in {expected_temp, "absent"}
            for _, _, temp_state in states
        ):
            raise SnapshotError("candidate apply recovery has inconsistent temp state")
    else:
        outcome = "mixed"
        for _, canonical_state, temp_state in states:
            expected = "baseline" if canonical_state == "candidate" else "candidate"
            if temp_state != expected:
                raise SnapshotError("mixed apply recovery has inconsistent temp state")

        for member, canonical_state, _ in states:
            if canonical_state != "candidate":
                continue
            _rename_exchange(
                parent_fd, member.temp_name, member.canonical_name
            )
            _fsync_directory(parent_fd)
            canonical_after = _journal_path_state(
                parent_fd, member.canonical_name, member
            )
            temp_after = _journal_path_state(
                parent_fd, member.temp_name, member
            )
            if canonical_after != "baseline" or temp_after != "candidate":
                # If the known baseline inode is still canonical, put any
                # concurrently displaced unknown inode back where it came from.
                if canonical_after == "baseline":
                    _rename_exchange(
                        parent_fd, member.temp_name, member.canonical_name
                    )
                    _fsync_directory(parent_fd)
                raise SnapshotError(
                    f"parallel edit interrupted apply recovery: {member.canonical_name}"
                )
        outcome = "baseline"
        expected_temp = "candidate"

    # Cleanup is restartable: journal removal is last, so a crash after one
    # known temp is removed simply observes an absent temp on the next pass.
    for member in journal.members:
        canonical_state = _journal_path_state(
            parent_fd, member.canonical_name, member
        )
        if canonical_state != outcome:
            raise SnapshotError(
                f"canonical path changed during apply cleanup: {member.canonical_name}"
            )
        temp_state = _journal_path_state(parent_fd, member.temp_name, member)
        if temp_state == "absent":
            continue
        if temp_state != expected_temp:
            raise SnapshotError(
                f"temp path changed during apply cleanup: {member.temp_name}"
            )
        os.unlink(member.temp_name, dir_fd=parent_fd)
        _fsync_directory(parent_fd)

    for member in journal.members:
        if (
            _journal_path_state(parent_fd, member.canonical_name, member)
            != outcome
        ):
            raise SnapshotError(
                f"canonical path changed before journal cleanup: {member.canonical_name}"
            )
        if _lstat_optional(parent_fd, member.temp_name) is not None:
            raise SnapshotError("apply temp path reappeared before journal cleanup")

    current_journal, current_payload, current_identity = _read_apply_journal(
        parent_fd, journal_name
    )
    if (
        current_journal != journal
        or current_payload != journal_payload
        or current_identity != journal_identity
    ):
        raise SnapshotError("apply journal changed before cleanup")
    os.unlink(journal_name, dir_fd=parent_fd)
    _fsync_directory(parent_fd)
    return outcome


def recover_pending(post_dir: str) -> int:
    canonical_parent, _ = _canonical_directory(post_dir)
    parent_fd = _open_dir_nofollow(canonical_parent)
    try:
        journal_names: list[str] = []
        entry_count = 0
        with os.scandir(parent_fd) as entries:
            for entry in entries:
                entry_count += 1
                if entry_count > MAX_RECOVERY_SCAN_ENTRIES:
                    raise SnapshotError(
                        "pending apply recovery directory exceeds scan bound"
                    )
                if entry.name.startswith(APPLY_JOURNAL_PREFIX):
                    journal_names.append(entry.name)
        for journal_name in sorted(journal_names):
            if not re.fullmatch(
                rf"{re.escape(APPLY_JOURNAL_PREFIX)}[0-9a-f]{{64}}"
                rf"{re.escape(APPLY_JOURNAL_SUFFIX)}",
                journal_name,
            ):
                raise SnapshotError("pending apply journal filename is invalid")
            _recover_apply_journal_fd(parent_fd, journal_name)
        return len(journal_names)
    finally:
        os.close(parent_fd)


def materialize_candidate(candidate_dir: str, token: str) -> None:
    parsed_token = _parse_token(token)
    meta = _parse_meta(parsed_token.meta_bytes)
    canonical_candidate, _ = _canonical_directory(candidate_dir)
    candidate_fd = _open_dir_nofollow(canonical_candidate)
    zh_name = str(meta["zh_name"])
    en_name = f"en-{zh_name}"
    try:
        _bounded_directory_names(
            candidate_fd,
            set(),
            require_exact=True,
            label="candidate directory",
        )
        _write_new_file(
            candidate_fd,
            zh_name,
            parsed_token.zh_bytes,
            int(meta["zh_mode"]),
        )
        if meta["en_present"]:
            if parsed_token.en_bytes is None:
                raise SnapshotError("internal English snapshot state mismatch")
            _write_new_file(
                candidate_fd,
                en_name,
                parsed_token.en_bytes,
                int(meta["en_mode"]),
            )
        _fsync_directory(candidate_fd)
    finally:
        os.close(candidate_fd)


def _capture_candidate_payload(
    candidate_dir: str, baseline_token: SnapshotToken
) -> tuple[bytes, bytes | None]:
    meta = _parse_meta(baseline_token.meta_bytes)
    canonical_candidate, _ = _canonical_directory(candidate_dir)
    candidate_fd = _open_dir_nofollow(canonical_candidate)
    candidate_zh_name = str(meta["zh_name"])
    candidate_en_name = f"en-{candidate_zh_name}"
    try:
        expected_names = {candidate_zh_name}
        if meta["en_present"]:
            expected_names.add(candidate_en_name)
        _bounded_directory_names(
            candidate_fd,
            expected_names,
            require_exact=True,
            label="candidate directory",
        )
        candidate_zh, _ = _read_regular_file(
            candidate_fd,
            candidate_zh_name,
            require_single_link=True,
            max_bytes=MAX_CANDIDATE_FILE_BYTES,
        )
        candidate_en: bytes | None = None
        if meta["en_present"]:
            candidate_en, _ = _read_regular_file(
                candidate_fd,
                candidate_en_name,
                require_single_link=True,
                max_bytes=MAX_CANDIDATE_FILE_BYTES,
            )
        if _frontmatter_bytes(candidate_zh, "zh-tw candidate") != _frontmatter_bytes(
            baseline_token.zh_bytes, "zh-tw baseline"
        ):
            raise SnapshotError("writer changed protected zh-tw frontmatter")
        if meta["en_present"]:
            if candidate_en is None or baseline_token.en_bytes is None:
                raise SnapshotError("internal English candidate state mismatch")
            if _frontmatter_bytes(
                candidate_en, "English candidate"
            ) != _frontmatter_bytes(baseline_token.en_bytes, "English baseline"):
                raise SnapshotError("writer changed protected English frontmatter")
        return candidate_zh, candidate_en
    finally:
        os.close(candidate_fd)


def capture_candidate(candidate_dir: str, token: str) -> str:
    baseline_token = _parse_token(token)
    candidate_zh, candidate_en = _capture_candidate_payload(
        candidate_dir, baseline_token
    )
    digest = _payload_digest(
        baseline_token.meta_bytes, candidate_zh, candidate_en
    )
    return _encode_token(
        baseline_token.path,
        digest,
        baseline_token.meta_bytes,
        candidate_zh,
        candidate_en,
    )


def apply_candidate(zh_path: str, candidate_dir: str, token: str) -> None:
    parsed_token = _parse_token(token)
    meta = _parse_meta(parsed_token.meta_bytes)
    target = Path(zh_path)
    if not target.is_absolute():
        raise SnapshotError(f"post path must be absolute: {zh_path}")
    if target.name != meta["zh_name"]:
        raise SnapshotError("snapshot token belongs to a different target file")

    candidate_zh, candidate_en = _capture_candidate_payload(
        candidate_dir, parsed_token
    )

    canonical_parent, _ = _canonical_directory(str(target.parent))
    parent_fd = _open_dir_nofollow(canonical_parent)
    zh_name = target.name
    en_name = f"en-{target.name}"
    zh_temp: str | None = None
    en_temp: str | None = None
    journal_name: str | None = None
    exchanged: list[tuple[str, str, bytes, int, tuple[int, int]]] = []
    apply_committed = False
    try:
        parent_info = os.fstat(parent_fd)
        if (
            parent_info.st_dev != meta["parent_dev"]
            or parent_info.st_ino != meta["parent_ino"]
        ):
            raise SnapshotError("target post directory identity changed")
        expected_journal_name = _journal_name_for_target(zh_name)
        if _lstat_optional(parent_fd, expected_journal_name) is not None:
            raise SnapshotError(
                "pending candidate apply journal must be recovered before retry"
            )

        # Never overwrite a human/parallel change made after capture.
        baseline_identities = _verify_pair_payload(
            parent_fd,
            zh_name,
            en_name,
            meta,
            parsed_token.zh_bytes,
            parsed_token.en_bytes,
            label="baseline",
        )
        zh_temp = _prepare_restore_file(
            parent_fd, "candidate-zh", candidate_zh, int(meta["zh_mode"])
        )
        if meta["en_present"]:
            if candidate_en is None:
                raise SnapshotError("English candidate is missing")
            en_temp = _prepare_restore_file(
                parent_fd, "candidate-en", candidate_en, int(meta["en_mode"])
            )

        # This early check avoids preparing/exchanging over obvious drift. The
        # exchange itself is the real CAS: it atomically preserves the exact
        # displaced inode at the temp name, then verifies its baseline bytes.
        baseline_identities = _verify_pair_payload(
            parent_fd,
            zh_name,
            en_name,
            meta,
            parsed_token.zh_bytes,
            parsed_token.en_bytes,
            label="baseline",
        )
        zh_candidate_info = os.stat(
            zh_temp, dir_fd=parent_fd, follow_symlinks=False
        )
        zh_candidate_identity = _file_identity(zh_candidate_info)
        en_candidate_identity: tuple[int, int] | None = None
        if meta["en_present"]:
            if en_temp is None:
                raise SnapshotError("English candidate temp file is missing")
            if candidate_en is None or parsed_token.en_bytes is None:
                raise SnapshotError("internal English candidate state mismatch")
            en_candidate_info = os.stat(
                en_temp, dir_fd=parent_fd, follow_symlinks=False
            )
            en_candidate_identity = _file_identity(en_candidate_info)

        journal_members = [
            JournalMember(
                canonical_name=zh_name,
                temp_name=zh_temp,
                baseline=JournalFileState(
                    payload=parsed_token.zh_bytes,
                    mode=int(meta["zh_mode"]),
                    identity=baseline_identities[zh_name],
                ),
                candidate=JournalFileState(
                    payload=candidate_zh,
                    mode=int(meta["zh_mode"]),
                    identity=zh_candidate_identity,
                ),
            )
        ]
        if meta["en_present"]:
            if (
                en_temp is None
                or candidate_en is None
                or parsed_token.en_bytes is None
                or en_candidate_identity is None
            ):
                raise SnapshotError("internal English journal state mismatch")
            journal_members.append(
                JournalMember(
                    canonical_name=en_name,
                    temp_name=en_temp,
                    baseline=JournalFileState(
                        payload=parsed_token.en_bytes,
                        mode=int(meta["en_mode"]),
                        identity=baseline_identities[en_name],
                    ),
                    candidate=JournalFileState(
                        payload=candidate_en,
                        mode=int(meta["en_mode"]),
                        identity=en_candidate_identity,
                    ),
                )
            )
        journal_name = _write_apply_journal(
            parent_fd,
            ApplyJournal(
                parent_identity=_file_identity(parent_info),
                zh_name=zh_name,
                members=tuple(journal_members),
            ),
        )

        if meta["en_present"]:
            if (
                en_temp is None
                or candidate_en is None
                or parsed_token.en_bytes is None
                or en_candidate_identity is None
            ):
                raise SnapshotError("internal English candidate state mismatch")
            _rename_exchange(parent_fd, en_temp, en_name)
            baseline_matches = _path_payload_matches(
                parent_fd,
                en_temp,
                parsed_token.en_bytes,
                int(meta["en_mode"]),
                baseline_identities[en_name],
            )
            candidate_matches = _path_payload_matches(
                parent_fd,
                en_name,
                candidate_en,
                int(meta["en_mode"]),
                en_candidate_identity,
            )
            if not baseline_matches or not candidate_matches:
                rollback_ok = _rollback_exchange_if_unchanged(
                    parent_fd,
                    en_name,
                    en_temp,
                    candidate_en,
                    int(meta["en_mode"]),
                    en_candidate_identity,
                )
                if not rollback_ok:
                    raise SnapshotError(
                        "English baseline changed during atomic apply; "
                        "later parallel edit was preserved"
                    )
                raise SnapshotError(
                    "English baseline changed during atomic candidate apply"
                )
            exchanged.append(
                (
                    en_name,
                    en_temp,
                    candidate_en,
                    int(meta["en_mode"]),
                    en_candidate_identity,
                )
            )
        if zh_temp is None:
            raise SnapshotError("zh-tw candidate temp file is missing")
        _rename_exchange(parent_fd, zh_temp, zh_name)
        baseline_matches = _path_payload_matches(
            parent_fd,
            zh_temp,
            parsed_token.zh_bytes,
            int(meta["zh_mode"]),
            baseline_identities[zh_name],
        )
        candidate_matches = _path_payload_matches(
            parent_fd,
            zh_name,
            candidate_zh,
            int(meta["zh_mode"]),
            zh_candidate_identity,
        )
        if not baseline_matches or not candidate_matches:
            rollback_ok = _rollback_exchange_if_unchanged(
                parent_fd,
                zh_name,
                zh_temp,
                candidate_zh,
                int(meta["zh_mode"]),
                zh_candidate_identity,
            )
            if not rollback_ok:
                raise SnapshotError(
                    "zh-tw baseline changed during atomic apply; "
                    "later parallel edit was preserved"
                )
            raise SnapshotError(
                "zh-tw baseline changed during atomic candidate apply"
            )
        exchanged.append(
            (
                zh_name,
                zh_temp,
                candidate_zh,
                int(meta["zh_mode"]),
                zh_candidate_identity,
            )
        )
        _fsync_directory(parent_fd)
        applied_identities = _verify_pair_payload(
            parent_fd,
            zh_name,
            en_name,
            meta,
            candidate_zh,
            candidate_en,
            label="candidate apply",
        )
        if applied_identities.get(zh_name) != zh_candidate_identity or (
            meta["en_present"]
            and applied_identities.get(en_name) != en_candidate_identity
        ):
            raise SnapshotError("candidate apply path identity changed")
        # Both canonical paths now hold the verified candidate. From this
        # durable consistency point, crash recovery finishes the commit instead
        # of attempting a partial rollback.
        exchanged.clear()
        apply_committed = True
        if journal_name is None:
            raise SnapshotError("candidate apply journal disappeared")
        if _recover_apply_journal_fd(parent_fd, journal_name) != "candidate":
            raise SnapshotError("candidate apply journal resolved unexpectedly")
        journal_name = None
        zh_temp = None
        en_temp = None
    except Exception as apply_error:
        rollback_conflict = False
        rollback_errors: list[str] = []
        if not apply_committed:
            for (
                canonical_name,
                displaced_name,
                candidate_payload,
                candidate_mode,
                candidate_identity,
            ) in reversed(exchanged):
                try:
                    if not _rollback_exchange_if_unchanged(
                        parent_fd,
                        canonical_name,
                        displaced_name,
                        candidate_payload,
                        candidate_mode,
                        candidate_identity,
                    ):
                        rollback_conflict = True
                except Exception as rollback_error:
                    rollback_errors.append(str(rollback_error))
            if (
                not rollback_conflict
                and not rollback_errors
                and journal_name is not None
            ):
                try:
                    if (
                        _recover_apply_journal_fd(parent_fd, journal_name)
                        != "baseline"
                    ):
                        rollback_errors.append(
                            "failed apply journal did not resolve to baseline"
                        )
                    else:
                        journal_name = None
                        zh_temp = None
                        en_temp = None
                except Exception as recovery_error:
                    rollback_errors.append(str(recovery_error))
        if rollback_conflict or rollback_errors:
            detail = "; ".join(rollback_errors) or "parallel edit preserved"
            raise SnapshotError(
                "candidate apply failed and atomic rollback could not restore "
                f"every baseline: {apply_error}; rollback: {detail}"
            ) from apply_error
        raise
    finally:
        # Before the durable journal exists, every temp is still a private
        # candidate inode and is safe to remove. Once journaled, a failed
        # exchange may have displaced a human edit into a temp path; recovery
        # owns cleanup and unknown evidence must remain untouched.
        if journal_name is None and not apply_committed:
            for temp_name in (zh_temp, en_temp):
                if temp_name is None:
                    continue
                try:
                    os.unlink(temp_name, dir_fd=parent_fd)
                except OSError:
                    pass
        os.close(parent_fd)


def persist_recovery(recovery_dir: str, token: str) -> str:
    parsed_token = _parse_token(token)
    canonical_recovery, recovery_info = _canonical_directory(recovery_dir)
    if stat.S_IMODE(recovery_info.st_mode) != 0o700:
        raise SnapshotError("recovery directory must have mode 700")
    recovery_fd = _open_dir_nofollow(canonical_recovery)
    try:
        for _ in range(32):
            name = (
                f"{Path(parsed_token.path).name}-{secrets.token_hex(12)}.token.json"
            )
            try:
                _write_new_file(recovery_fd, name, token.encode("utf-8"), 0o600)
                _fsync_directory(recovery_fd)
                return str(Path(canonical_recovery) / name)
            except FileExistsError:
                continue
    finally:
        os.close(recovery_fd)
    raise SnapshotError("could not allocate a durable recovery token")


def restore_snapshot(zh_path: str, token: str) -> None:
    parsed_token = _parse_token(token)
    meta = _parse_meta(parsed_token.meta_bytes)
    zh_bytes = parsed_token.zh_bytes
    en_bytes = parsed_token.en_bytes

    target = Path(zh_path)
    if not target.is_absolute():
        raise SnapshotError(f"post path must be absolute: {zh_path}")
    if target.name != meta["zh_name"]:
        raise SnapshotError("snapshot token belongs to a different target file")
    zh_name = target.name
    en_name = f"en-{target.name}"

    canonical_parent, _ = _canonical_directory(str(target.parent))
    parent_fd = _open_dir_nofollow(canonical_parent)
    zh_temp: str | None = None
    en_temp: str | None = None
    try:
        parent_info = os.fstat(parent_fd)
        if (
            parent_info.st_dev != meta["parent_dev"]
            or parent_info.st_ino != meta["parent_ino"]
        ):
            raise SnapshotError("target post directory identity changed")
        _require_regular_or_absent(parent_fd, zh_name)
        _require_regular_or_absent(parent_fd, en_name)

        zh_temp = _prepare_restore_file(
            parent_fd, "zh", zh_bytes, int(meta["zh_mode"])
        )
        if meta["en_present"]:
            if en_bytes is None:
                raise SnapshotError("internal English snapshot state mismatch")
            en_temp = _prepare_restore_file(
                parent_fd, "en", en_bytes, int(meta["en_mode"])
            )

        _require_regular_or_absent(parent_fd, zh_name)
        _require_regular_or_absent(parent_fd, en_name)
        if meta["en_present"]:
            if en_temp is None:
                raise SnapshotError("English restore file was not prepared")
            os.replace(
                en_temp,
                en_name,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
            )
            en_temp = None
        else:
            en_info = _require_regular_or_absent(parent_fd, en_name)
            if en_info is not None:
                os.unlink(en_name, dir_fd=parent_fd)

        if zh_temp is None:
            raise SnapshotError("zh-tw restore file was not prepared")
        os.replace(
            zh_temp,
            zh_name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        zh_temp = None
        _fsync_directory(parent_fd)
        _verify_restored_pair(
            parent_fd, zh_name, en_name, meta, zh_bytes, en_bytes
        )
    finally:
        for temp_name in (zh_temp, en_temp):
            if temp_name is None:
                continue
            try:
                os.unlink(temp_name, dir_fd=parent_fd)
            except OSError:
                pass
        os.close(parent_fd)


def discard_snapshot(token: str) -> None:
    parsed_token = _parse_token(token)
    snapshot_dir = parsed_token.path
    try:
        _snapshot_payload(snapshot_dir, parsed_token.digest)
    except FileNotFoundError:
        return

    snapshot_path = Path(snapshot_dir)
    parent_fd = _open_dir_nofollow(str(snapshot_path.parent))
    snapshot_fd = os.open(
        snapshot_path.name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        dir_fd=parent_fd,
    )
    try:
        opened = os.fstat(snapshot_fd)
        linked = os.stat(
            snapshot_path.name, dir_fd=parent_fd, follow_symlinks=False
        )
        if (
            not stat.S_ISDIR(linked.st_mode)
            or opened.st_dev != linked.st_dev
            or opened.st_ino != linked.st_ino
        ):
            raise SnapshotError("snapshot directory changed before cleanup")

        names = _bounded_directory_names(
            snapshot_fd,
            SNAPSHOT_FILES,
            require_exact=False,
            label="snapshot cleanup",
        )
        for name in names:
            info = os.stat(name, dir_fd=snapshot_fd, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise SnapshotError("snapshot cleanup entry is not a regular file")
        for name in names:
            os.unlink(name, dir_fd=snapshot_fd)
        _fsync_directory(snapshot_fd)
    finally:
        os.close(snapshot_fd)

    try:
        os.rmdir(snapshot_path.name, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("zh_path")

    restore = subparsers.add_parser("restore")
    restore.add_argument("zh_path")
    restore.add_argument("token")

    materialize = subparsers.add_parser("materialize-candidate")
    materialize.add_argument("candidate_dir")
    materialize.add_argument("token")

    capture = subparsers.add_parser("capture-candidate")
    capture.add_argument("candidate_dir")
    capture.add_argument("token")

    apply = subparsers.add_parser("apply-candidate")
    apply.add_argument("zh_path")
    apply.add_argument("candidate_dir")
    apply.add_argument("token")

    recover = subparsers.add_parser("recover-pending")
    recover.add_argument("post_dir")

    persist = subparsers.add_parser("persist-recovery")
    persist.add_argument("recovery_dir")
    persist.add_argument("token")

    discard = subparsers.add_parser("discard")
    discard.add_argument("token")
    return parser


def main() -> int:
    args = _parser().parse_args()
    recovery_path: str | None = None
    try:
        if args.command == "create":
            print(create_snapshot(args.zh_path))
            return 0
        if args.command == "recover-pending":
            print(recover_pending(args.post_dir))
            return 0

        token = sys.stdin.read() if args.token == "-" else args.token
        recovery_path = _parse_token(token).path
        if args.command == "restore":
            restore_snapshot(args.zh_path, token)
        elif args.command == "materialize-candidate":
            materialize_candidate(args.candidate_dir, token)
        elif args.command == "capture-candidate":
            print(capture_candidate(args.candidate_dir, token))
        elif args.command == "apply-candidate":
            apply_candidate(args.zh_path, args.candidate_dir, token)
        elif args.command == "persist-recovery":
            print(persist_recovery(args.recovery_dir, token))
        else:
            discard_snapshot(token)
        return 0
    except (OSError, SnapshotError, ValueError) as error:
        if args.command == "restore":
            suffix = (
                f"; snapshot evidence path is {recovery_path} (integrity is not assumed)"
                if recovery_path
                else ""
            )
            print(
                "[tribunal-snapshot] ERROR: failed to restore bilingual post pair"
                f"{suffix}: {error}",
                file=sys.stderr,
            )
            return 70
        print(f"[tribunal-snapshot] ERROR: {error}", file=sys.stderr)
        return (
            70
            if args.command in {"create", "apply-candidate", "recover-pending"}
            else 1
        )


if __name__ == "__main__":
    raise SystemExit(main())
