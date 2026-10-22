#!/bin/bash
# PreToolUse(Bash) hook：擋掉繞過 git hook 的指令（Claude Code 跟 Codex 共用這支）。
# 為什麼：hook 失敗 = 修 code 或修 hook，不准跳（見 AGENTS.md〈🚫 絕對不准 --no-verify〉）。
# 這支只是 fail-fast，讓 agent 早點知道走錯路；真正的防線是 CI（PR 要過 ci-passed 才進得了 main）。
#
# 擋：
#   - git commit / push / merge 等子指令帶 --no-verify / --no-gpg-sign（含 --no-veri 這種縮寫）
#   - git commit、git am 的 -n，含合併短旗標 -nm、-anm；git push -n 是 dry-run，放行
#   - 子指令前的 -c core.hooksPath=… / --config-env=core.hooksPath=…
# 不誤擋：先丟掉 heredoc 內文（沒引號、內文又有 $(…) 或 `…` 時整段保留），引號內的文字當成一個參數，再丟掉 # 註解；
#   commit message 裡「提到」這些旗標不會被擋，-m 的值（例如 -mn 裡的 n）也不會被當成旗標。
# 範圍：防的是看到 hook 失敗、順手照提示加 --no-verify 的 agent，不是刻意繞路的人；
#   bash -c、eval、git alias、變數展開、雙引號裡的 $(…)、用 git config 寫入 core.hooksPath 都不管。
#   只要出現單獨一個 git 就當成 git 指令檢查，所以 `echo git commit -n` 也會被擋。
#   解析不了就放行，這支壞掉不會卡死所有 Bash 指令。
# 測試：tests/block-no-verify-hook.test.ts。只用 bash 3.2 有的語法（macOS 內建 bash）。

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$COMMAND" ] || exit 0

# 把指令拆成「一行一個簡單指令、參數之間用空白隔開」：
#   1. 丟掉 heredoc 內文與結束標記，其他接續行（\ 換行）併成一行。heredoc 內文照 bash 的規則：
#      標記有引號（<<'EOF'）就原樣保留，沒引號才先併接續行，再找結束標記；
#      沒引號時 bash 照樣會執行內文的 $(…) 和 `…`；猜不準它們在哪裡結束，所以內文只要有這兩種，整段都當指令檢查（寧可多擋）；
#      引號和 # 註解裡的 <<EOF 只是文字，不算 heredoc 起點
#   2. 由左到右處理跳脫字元、引號、# 註解：引號內的文字當成一個參數（空白和分隔符換成 _），註解丟掉
#   3. 沒加引號的 $(…)、<(…)、`…` 原地換成一個參數 _，裡面的內容接到最後，另外當成指令檢查
#   4. 重新導向連同目標一起丟掉（2>&1、&>log、>out、<in），免得 & 被當成分隔符、git>out 認不出 git
#   5. ; & | ( ) ` 換成換行
STATEMENTS=$(printf '%s' "$COMMAND" | perl -0777 -ne '
  my @lines = split /\n/, $_, -1;
  my $continued = qr/(?<!\\)(?:\\\\)*\\$/;
  my @kept;
  my $i = 0;
  while ($i < @lines) {
    my $line = $lines[$i++];
    $line = substr($line, 0, -1) . $lines[$i++] while $line =~ $continued && $i < @lines;
    push @kept, $line;
    (my $ops = $line) =~ s{((?<!<)<<(?!<)-?[ \t]*\\?([\x27"]?)[A-Za-z_]\w*\2)|\\.|"(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27|(?<![^\s;&|()`])#.*}{$1 // ""}ge;
    while ($ops =~ /(?<!<)<<(?!<)-?[ \t]*(\\?)([\x27"]?)([A-Za-z_]\w*)\2/g) {
      my ($literal, $marker, $text) = ("$1$2", $3, "");
      for (my $end = $i; $end < @lines; ) {
        my $body = $lines[$end++];
        $body = substr($body, 0, -1) . $lines[$end++]
          while $literal eq "" && $body =~ $continued && $end < @lines;
        if ($body =~ /^\s*\Q$marker\E\s*$/) { $i = $end; last }
        $text .= "$body\n";
      }
      # heredoc 內文的引號只是一般字元，換成空白，免得後面把指令包進引號參數裡
      push @kept, $text =~ tr/"\x27/  /r if $literal eq "" && $text =~ /(?<!\\)(?:\\\\)*(?:\$\(|`)/;
    }
  }
  $_ = join "\n", @kept;
  s{\\(.)|"((?:[^"\\]|\\.)*)"|\x27([^\x27]*)\x27|(?<![^\s;&|()`])#[^\n]*}{
    my $word = defined $1 ? $1 : defined $2 ? $2 : $3;
    if (defined $word) { $word =~ s/[\s;&|()<>`]/_/g; length $word ? $word : "_" } else { "" }
  }gse;
  while (s{[\$<>]\(([^()]*)\)|`([^`]*)`}{_}) { $_ .= "\n" . (defined $1 ? $1 : $2) }
  s/(?:[0-9]*|&)(?:>>?|<)(?:&[0-9-]*|\s*[^\s;&|()<>]*)/ /g;
  s/[;&|()`]/\n/g;
  print;
' 2>/dev/null) || exit 0

is_hooks_path() {
  local key
  key=$(printf '%s' "${1%%=*}" | tr '[:upper:]' '[:lower:]')
  [ "$key" = core.hookspath ]
}

# 合併短旗標 $1 裡有沒有 n。$2 是要帶值的字母（例如 commit 的 m、F），後面全是值；
# 要帶值的字母在最後一個時，值是下一個參數，用 VALUE_IS_NEXT=1 告訴呼叫端跳過。
# $3 是值只能直接接在後面的字母（例如 -S<keyid>），後面也全是值。
cluster_has_n() {
  local letters=${1#-} idx letter
  VALUE_IS_NEXT=0
  for ((idx = 0; idx < ${#letters}; idx++)); do
    letter=${letters:idx:1}
    [ "$letter" = n ] && return 0
    case $2 in *"$letter"*)
      [ "$idx" -eq $((${#letters} - 1)) ] && VALUE_IS_NEXT=1
      return 1
      ;;
    esac
    case $3 in *"$letter"*) return 1 ;; esac
  done
  return 1
}

# 傳入 git 後面的參數；回傳 0 表示會繞過 hook。
git_bypasses_hooks() {
  local args=("$@") count=$# i=0 word sub value_letters attached_letters long_values
  while [ "$i" -lt "$count" ]; do
    word=${args[i]}
    case $word in
      -c | --config-env)
        is_hooks_path "${args[i + 1]}" && return 0
        i=$((i + 2))
        continue
        ;;
      --config-env=*) is_hooks_path "${word#--config-env=}" && return 0 ;;
      -C | --git-dir | --work-tree | --namespace | --super-prefix | --attr-source)
        i=$((i + 2))
        continue
        ;;
      -*) ;;
      *) break ;;
    esac
    i=$((i + 1))
  done

  # commit 和 am 的 -n 是 --no-verify，要知道哪些旗標帶值，才不會把值裡的 n 當成旗標：
  # 要帶值的短旗標字母、值只能直接接在後面的字母、值可以是下一個參數的長旗標
  sub=${args[i]}
  case $sub in
    commit)
      value_letters=CFcmt attached_letters=Su
      long_values=' --author --cleanup --date --file --fixup --message --pathspec-from-file
        --reedit-message --reuse-message --squash --template --trailer '
      ;;
    am)
      value_letters=Cp attached_letters=S
      long_values=' --directory --empty --exclude --include --patch-format --quoted-cr
        --resolvemsg --whitespace '
      ;;
    cherry-pick | merge | pull | push | rebase | revert | send-email) value_letters= ;;
    *) return 1 ;;
  esac
  i=$((i + 1))
  while [ "$i" -lt "$count" ]; do
    word=${args[i]}
    i=$((i + 1))
    case $word in
      --) return 1 ;;
      --no-v*) [[ --no-verify == "$word"* ]] && return 0 ;;
      --no-g*) [[ --no-gpg-sign == "$word"* ]] && return 0 ;;
    esac
    [ -n "$value_letters" ] || continue
    case $word in
      --*) case $long_values in *[[:space:]]"$word"[[:space:]]*) i=$((i + 1)) ;; esac ;;
      -?*)
        cluster_has_n "$word" "$value_letters" "$attached_letters" && return 0
        [ "$VALUE_IS_NEXT" -eq 1 ] && i=$((i + 1))
        ;;
    esac
  done
  return 1
}

while IFS= read -r statement; do
  read -ra words <<<"$statement"
  for ((k = 0; k < ${#words[@]}; k++)); do
    # 用 case 比對，不用 ${words[k]##*/}：後者遇到很長的參數會慢到跟長度平方成正比
    case ${words[k]} in git | */git) ;; *) continue ;; esac
    if git_bypasses_hooks "${words[@]:k+1}"; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "gu-log 禁止繞過 git hook（--no-verify、git commit -n、-c core.hooksPath=… 都算）。hook 擋下來就修 code 或修 hook，不准跳。見 AGENTS.md〈🚫 絕對不准 --no-verify〉。"
        }
      }'
      exit 0
    fi
  done
done <<<"$STATEMENTS"

# 沒擋：exit 0 不輸出，交回一般的 permission 流程
exit 0
