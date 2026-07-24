const NON_EMPTY = Symbol('non-empty');
const NUMBER = Symbol('number');

function fail(sourceName, message) {
  throw new Error(`${sourceName}: rendered adapter DOM contract violation: ${message}`);
}

function normalizeClasses(node) {
  const value = node.properties?.className ?? [];
  const classes = Array.isArray(value) ? value : String(value).split(/\s+/);
  return classes.filter(Boolean).sort();
}

function describe(node) {
  if (node?.type !== 'element') return node?.type ?? 'missing node';
  const classes = normalizeClasses(node);
  return `<${node.tagName}${classes.length > 0 ? `.${classes.join('.')}` : ''}>`;
}

function elementChildren(node) {
  return (node.children ?? []).filter((child) => child.type === 'element');
}

function singleReference(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

function valueMatches(value, expected) {
  if (expected === NON_EMPTY) {
    return (
      (typeof value === 'string' && value.length > 0) ||
      (Array.isArray(value) &&
        value.length > 0 &&
        value.every((part) => typeof part === 'string' && part.length > 0))
    );
  }
  if (expected === NUMBER) {
    return (
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value)))
    );
  }
  if (Array.isArray(expected)) return expected.includes(value);
  return value === expected;
}

function attrs(required = {}, optional = {}) {
  return { required, optional };
}

function node(tagName, classes = [], options = {}) {
  return {
    tagName,
    classes: Array.isArray(classes[0]) ? classes : [classes],
    attributes: options.attributes ?? attrs(),
    children: options.children ?? [],
    opaque: options.opaque ?? false,
    text:
      options.text ??
      (options.children === undefined &&
      ['button', 'figcaption', 'p', 'span', 'strong'].includes(tagName)
        ? 'any'
        : 'whitespace'),
    check: options.check,
  };
}

function child(schema, options = {}) {
  return {
    schema,
    min: options.min ?? 1,
    max: options.max ?? 1,
  };
}

function optional(schema) {
  return child(schema, { min: 0, max: 1 });
}

function repeated(schema, min, max = Number.POSITIVE_INFINITY) {
  return child(schema, { min, max });
}

function hasIdentity(candidate, schema) {
  if (candidate?.type !== 'element' || candidate.tagName !== schema.tagName) return false;
  const actual = JSON.stringify(normalizeClasses(candidate));
  return schema.classes.some((expected) => JSON.stringify([...expected].sort()) === actual);
}

function assertAttributes(candidate, schema, sourceName) {
  const actual = Object.entries(candidate.properties ?? {}).filter(
    ([name]) => name !== 'className' && !/^dataAstro/i.test(name)
  );
  const allowed = { ...schema.attributes.required, ...schema.attributes.optional };

  for (const [name] of actual) {
    if (!Object.hasOwn(allowed, name)) {
      fail(sourceName, `${describe(candidate)} has unknown attribute ${name}`);
    }
  }

  for (const [name, expected] of Object.entries(schema.attributes.required)) {
    if (!Object.hasOwn(candidate.properties ?? {}, name)) {
      fail(sourceName, `${describe(candidate)} is missing required attribute ${name}`);
    }
    const actualValue = candidate.properties[name];
    if (!valueMatches(actualValue, expected)) {
      fail(sourceName, `${describe(candidate)} has invalid ${name}=${JSON.stringify(actualValue)}`);
    }
  }

  for (const [name, expected] of Object.entries(schema.attributes.optional)) {
    if (
      Object.hasOwn(candidate.properties ?? {}, name) &&
      !valueMatches(candidate.properties[name], expected)
    ) {
      fail(
        sourceName,
        `${describe(candidate)} has invalid ${name}=${JSON.stringify(candidate.properties[name])}`
      );
    }
  }
}

function assertNode(candidate, schema, sourceName, path) {
  if (!hasIdentity(candidate, schema)) {
    fail(
      sourceName,
      `${path} expected <${schema.tagName}> with class ${schema.classes
        .map((classes) => classes.join(' '))
        .join(' or ')}, got ${describe(candidate)}`
    );
  }

  assertAttributes(candidate, schema, sourceName);
  if (!schema.opaque) {
    const directText = (candidate.children ?? [])
      .filter((child) => child.type === 'text')
      .map((child) => child.value)
      .join('');
    if (schema.text === 'whitespace' && directText.trim().length > 0) {
      fail(sourceName, `${path} has unknown direct text ${JSON.stringify(directText.trim())}`);
    }
    assertChildSequence(candidate, schema.children, sourceName, path);
  }
  schema.check?.(candidate, sourceName);
}

function assertChildSequence(parent, sequence, sourceName, path) {
  const actual = elementChildren(parent);
  let index = 0;

  for (const entry of sequence) {
    let count = 0;
    while (index < actual.length && count < entry.max && hasIdentity(actual[index], entry.schema)) {
      assertNode(actual[index], entry.schema, sourceName, `${path}/${describe(actual[index])}`);
      index += 1;
      count += 1;
    }
    if (count < entry.min) {
      fail(
        sourceName,
        `${path} expected ${entry.min === entry.max ? entry.min : `at least ${entry.min}`} direct ${
          entry.schema.tagName
        }.${entry.schema.classes[0].join('.')}`
      );
    }
  }

  if (index !== actual.length) {
    fail(sourceName, `${path} has unknown direct child ${describe(actual[index])}`);
  }
}

const plainSpan = node('span');
const plainStrong = node('strong');
const plainParagraph = node('p');

const moguToggle = node('button', ['mogu-note-toggle'], {
  attributes: attrs({
    type: 'button',
    ariaExpanded: 'false',
    ariaControls: NON_EMPTY,
    hidden: true,
  }),
  children: [
    child(
      node('span', ['mogu-note-toggle-icon'], {
        attributes: attrs({ ariaHidden: 'true' }),
      })
    ),
    child(node('span', ['mogu-note-toggle-label'])),
  ],
});

const moguSummary = node('div', ['mogu-note-summary'], {
  attributes: attrs({ hidden: true }),
  children: [child(node('span', ['mogu-note-summary-label'])), child(plainParagraph)],
});

const moguPrefixLink = node('a', ['mogu-prefix-link'], {
  attributes: attrs({ href: NON_EMPTY, ariaLabel: NON_EMPTY }),
  children: [
    child(
      node('img', ['mogu-prefix-icon'], {
        attributes: attrs({
          src: '/mogu-picks-icon.png',
          alt: '',
          width: 20,
          height: 20,
        }),
      })
    ),
    child(plainSpan),
  ],
});

const moguRoot = node('blockquote', [['mogu-note'], ['mogu-note', 'mogu-note--murmur']], {
  attributes: attrs({
    dataMoguNote: '',
    dataMarkdownAdapter: 'mogu-note',
    dataHasSummary: ['true', 'false'],
  }),
  children: [
    child(
      node('strong', ['mogu-prefix'], {
        children: [optional(moguPrefixLink), child(plainSpan)],
      })
    ),
    optional(moguSummary),
    child(
      node('div', ['mogu-note-content'], {
        attributes: attrs({ id: NON_EMPTY }),
        opaque: true,
      })
    ),
    optional(moguToggle),
  ],
  check(candidate, sourceName) {
    const children = elementChildren(candidate);
    const hasSummary = children.some((item) => hasIdentity(item, moguSummary));
    const hasToggle = children.some((item) => hasIdentity(item, moguToggle));
    const expected = candidate.properties.dataHasSummary === 'true';
    if (hasSummary !== expected || hasToggle !== expected) {
      fail(sourceName, 'mogu-note summary/toggle hierarchy disagrees with dataHasSummary');
    }
    if (hasToggle) {
      const content = children.find((item) =>
        item.properties?.className?.includes('mogu-note-content')
      );
      const toggle = children.find((item) => hasIdentity(item, moguToggle));
      if (singleReference(toggle.properties.ariaControls) !== content.properties.id) {
        fail(sourceName, 'mogu-note toggle ariaControls does not target its content');
      }
    }
  },
});

const shroomdogToggle = node('button', ['shroomdog-note-toggle'], {
  attributes: attrs({
    type: 'button',
    ariaExpanded: 'false',
    ariaControls: NON_EMPTY,
    dataExpandLabel: NON_EMPTY,
    dataCollapseLabel: NON_EMPTY,
    hidden: true,
  }),
  children: [
    child(
      node('span', ['shroomdog-note-toggle-icon'], {
        attributes: attrs({ ariaHidden: 'true' }),
      })
    ),
    child(node('span', ['shroomdog-note-toggle-label'])),
  ],
});

const shroomdogRoot = node('blockquote', ['shroomdog-note'], {
  attributes: attrs({
    dataShroomdogNote: '',
    dataMarkdownAdapter: 'shroomdog-note',
    dataAutoFold: ['true', 'false'],
    dataCollapseThreshold: NUMBER,
    dataMinExpandableOverflow: NUMBER,
  }),
  children: [
    child(
      node('strong', ['shroomdog-prefix'], {
        text: 'any',
        children: [
          child(
            node('img', ['shroomdog-prefix-icon'], {
              attributes: attrs({
                src: '/shroomdog-icon-128.png',
                alt: 'ShroomDog',
                width: 22,
                height: 22,
              }),
            })
          ),
        ],
      })
    ),
    child(
      node('div', ['shroomdog-note-content'], {
        attributes: attrs({ id: NON_EMPTY }),
        opaque: true,
      })
    ),
    optional(shroomdogToggle),
  ],
  check(candidate, sourceName) {
    const children = elementChildren(candidate);
    const toggle = children.find((item) => hasIdentity(item, shroomdogToggle));
    const hasToggle = Boolean(toggle);
    if (hasToggle !== (candidate.properties.dataAutoFold === 'true')) {
      fail(sourceName, 'shroomdog-note toggle hierarchy disagrees with dataAutoFold');
    }
    if (toggle) {
      const content = children.find((item) =>
        item.properties?.className?.includes('shroomdog-note-content')
      );
      if (singleReference(toggle.properties.ariaControls) !== content.properties.id) {
        fail(sourceName, 'shroomdog-note toggle ariaControls does not target its content');
      }
    }
  },
});

const toggleRoot = node('div', ['toggle-container'], {
  attributes: attrs({
    dataOpen: ['true', 'false'],
    dataMarkdownAdapter: 'toggle',
  }),
  children: [
    child(
      node('button', ['toggle-header'], {
        attributes: attrs({ ariaExpanded: ['true', 'false'] }),
        children: [child(node('span', ['toggle-icon'])), child(node('span', ['toggle-title']))],
      })
    ),
    child(
      node('div', ['toggle-wrapper'], {
        children: [
          child(
            node('div', ['toggle-inner'], {
              children: [
                child(
                  node('div', ['toggle-content'], {
                    opaque: true,
                  })
                ),
              ],
            })
          ),
        ],
      })
    ),
  ],
  check(candidate, sourceName) {
    const [header] = elementChildren(candidate);
    if (candidate.properties.dataOpen !== header.properties.ariaExpanded) {
      fail(sourceName, 'toggle ariaExpanded disagrees with dataOpen');
    }
  },
});

const progressRoot = node('div', ['levelup-progress'], {
  attributes: attrs({ dataMarkdownAdapter: 'level-up-progress' }),
  children: [
    child(
      node('div', ['progress-header'], {
        children: [
          child(node('span', ['progress-level'])),
          optional(node('span', ['progress-title'])),
        ],
      })
    ),
    child(
      node('div', ['progress-bar-track'], {
        attributes: attrs({
          role: 'progressbar',
          ariaValueNow: NUMBER,
          ariaValueMin: NUMBER,
          ariaValueMax: NUMBER,
        }),
        children: [
          child(
            node('div', ['progress-bar-fill'], {
              attributes: attrs({ style: NON_EMPTY }),
            })
          ),
        ],
      })
    ),
    child(node('div', ['progress-percentage'], { text: 'any' })),
  ],
});

const quizOption = node('button', ['quiz-option'], {
  attributes: attrs({ dataLabel: NON_EMPTY, type: 'button' }),
  children: [child(node('span', ['option-label'])), child(node('span', ['option-text']))],
});

const correctResult = node('div', ['result-correct'], {
  attributes: attrs({ hidden: true }),
  children: [
    child(node('span', ['result-icon'])),
    child(plainStrong),
    child(node('p', ['result-explanation'])),
  ],
});

const wrongResult = node('div', ['result-wrong'], {
  attributes: attrs({ hidden: true }),
  children: [
    child(node('span', ['result-icon'])),
    child(plainStrong),
    child(
      node('p', ['result-answer'], {
        text: 'any',
        children: [child(plainStrong)],
      })
    ),
    child(node('p', ['result-explanation'])),
  ],
});

const quizRoot = node('div', ['levelup-quiz'], {
  attributes: attrs({
    dataQuizId: NON_EMPTY,
    dataAnswer: NON_EMPTY,
    dataMarkdownAdapter: 'level-up-quiz',
  }),
  children: [
    child(
      node('div', ['quiz-header'], {
        children: [child(node('span', ['quiz-icon'])), child(node('span', ['quiz-label']))],
      })
    ),
    child(node('p', ['quiz-question'])),
    child(
      node('div', ['quiz-options'], {
        children: [repeated(quizOption, 1)],
      })
    ),
    child(
      node('div', ['quiz-result'], {
        attributes: attrs({ ariaLive: 'polite' }),
        children: [child(correctResult), child(wrongResult)],
      })
    ),
  ],
});

const analogyRoot = node('aside', ['analogy-box'], {
  attributes: attrs({ role: 'note', dataMarkdownAdapter: 'analogy-box' }),
  children: [
    child(
      node('div', ['analogy-header'], {
        children: [child(node('span', ['analogy-title'])), child(node('span', ['analogy-badge']))],
      })
    ),
    child(node('div', ['analogy-content'], { opaque: true })),
  ],
});

const mermaidRoot = node('div', ['mermaid-wrapper'], {
  attributes: attrs({ dataMarkdownAdapter: 'mermaid' }),
  children: [
    child(
      node('div', ['mermaid-scroll'], {
        children: [
          child(
            node('div', ['mermaid-source'], {
              attributes: attrs({ style: 'display:none;', dataMermaid: '' }),
              text: 'any',
            })
          ),
          child(node('div', ['mermaid-render'])),
        ],
      })
    ),
    optional(node('p', ['mermaid-caption'])),
    child(
      node('button', ['mermaid-expand-btn'], {
        attributes: attrs({ ariaLabel: NON_EMPTY, title: NON_EMPTY }),
        children: [
          child(
            node('svg', [], {
              attributes: attrs({
                width: '18',
                height: '18',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: '2',
              }),
              children: [
                child(
                  node('path', [], {
                    attributes: attrs({
                      d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
                    }),
                  })
                ),
              ],
            })
          ),
        ],
      })
    ),
  ],
});

const postImageRoot = node('figure', ['post-image'], {
  attributes: attrs({
    dataPostImage: '',
    dataMarkdownAdapter: 'post-image',
  }),
  children: [
    child(
      node('button', ['post-image-open'], {
        attributes: attrs({
          type: 'button',
          ariaLabel: NON_EMPTY,
          ariaHasPopup: 'dialog',
          ariaControls: NON_EMPTY,
          dataPostImageOpen: '',
        }),
        children: [
          child(
            node('img', [], {
              attributes: attrs(
                {
                  src: NON_EMPTY,
                  alt: NON_EMPTY,
                  loading: 'lazy',
                  decoding: 'async',
                  width: NUMBER,
                  height: NUMBER,
                },
                { ariaDescribedBy: NON_EMPTY }
              ),
            })
          ),
          child(
            node('span', ['post-image-zoom-hint'], {
              attributes: attrs({ ariaHidden: 'true' }),
            })
          ),
        ],
      })
    ),
    optional(
      node('figcaption', [], {
        attributes: attrs({ id: NON_EMPTY }),
      })
    ),
    child(
      node('div', ['post-image-dialog'], {
        attributes: attrs(
          {
            id: NON_EMPTY,
            role: 'dialog',
            ariaModal: 'true',
            ariaLabel: NON_EMPTY,
            hidden: true,
            dataPostImageDialog: '',
          },
          { ariaDescribedBy: NON_EMPTY }
        ),
        children: [
          child(
            node('div', ['post-image-dialog-surface'], {
              attributes: attrs({ dataPostImageSurface: '' }),
              children: [
                child(
                  node('button', ['post-image-close'], {
                    attributes: attrs({
                      type: 'button',
                      ariaLabel: NON_EMPTY,
                      dataPostImageClose: '',
                    }),
                  })
                ),
                child(
                  node('div', ['post-image-dialog-scroll'], {
                    attributes: attrs({ dataPostImageScroll: '' }),
                    children: [
                      child(
                        node('img', ['post-image-dialog-img'], {
                          attributes: attrs(
                            {
                              alt: NON_EMPTY,
                              dataFullSrc: NON_EMPTY,
                              draggable: 'false',
                              decoding: 'async',
                              dataPostImageExpandedImg: '',
                            },
                            { ariaDescribedBy: NON_EMPTY }
                          ),
                        })
                      ),
                    ],
                  })
                ),
                optional(node('p', ['post-image-dialog-caption'])),
              ],
            })
          ),
        ],
      })
    ),
  ],
  check(candidate, sourceName) {
    const children = elementChildren(candidate);
    const open = children[0];
    const caption = children.find((item) => item.tagName === 'figcaption');
    const dialog = children.find((item) =>
      item.properties?.className?.includes('post-image-dialog')
    );
    const [primaryImage] = elementChildren(open);
    const [surface] = elementChildren(dialog);
    const surfaceChildren = elementChildren(surface);
    const scroll = surfaceChildren.find((item) =>
      item.properties?.className?.includes('post-image-dialog-scroll')
    );
    const [expandedImage] = elementChildren(scroll);
    const dialogCaption = surfaceChildren.find((item) =>
      item.properties?.className?.includes('post-image-dialog-caption')
    );

    if (singleReference(open.properties.ariaControls) !== dialog.properties.id) {
      fail(sourceName, 'post-image open control does not target its dialog');
    }
    if (
      open.properties.ariaLabel !== dialog.properties.ariaLabel ||
      primaryImage.properties.alt !== expandedImage.properties.alt
    ) {
      fail(sourceName, 'post-image primary and dialog representations disagree');
    }
    if (Boolean(caption) !== Boolean(dialogCaption)) {
      fail(sourceName, 'post-image caption hierarchy differs between primary and dialog views');
    }

    const describedBy = [
      primaryImage.properties.ariaDescribedBy,
      dialog.properties.ariaDescribedBy,
      expandedImage.properties.ariaDescribedBy,
    ];
    if (caption) {
      if (describedBy.some((value) => singleReference(value) !== caption.properties.id)) {
        fail(sourceName, 'post-image ariaDescribedBy does not target its caption');
      }
    } else if (describedBy.some((value) => value !== undefined)) {
      fail(sourceName, 'post-image without a caption must not expose ariaDescribedBy');
    }
  },
});

function diffPanel(kind) {
  return node('div', ['diff-panel', `diff-${kind}`], {
    children: [
      child(
        node('div', ['diff-header', `diff-header--${kind}`], {
          children: [child(node('span', ['diff-icon'])), child(node('span', ['diff-label']))],
        })
      ),
      child(node('div', ['diff-body'], { text: 'any' })),
    ],
  });
}

const diffRoot = node('div', ['diff-block'], {
  attributes: attrs({ dataMarkdownAdapter: 'diff-block' }),
  children: [child(diffPanel('before')), child(diffPanel('after'))],
});

function modelCard(kind) {
  return node('div', ['model-card', kind], {
    children: [child(plainSpan), child(plainStrong)],
  });
}

const learningStep = node('li', [], {
  children: [
    child(node('div', ['step-label'], { text: 'any' })),
    child(plainParagraph),
    child(plainSpan),
  ],
});

const learningMapRoot = node('section', ['codex-learning-map'], {
  attributes: attrs({
    ariaLabel: NON_EMPTY,
    dataMarkdownAdapter: 'codex-learning-map',
  }),
  children: [
    child(
      node('div', ['model-shift'], {
        children: [
          child(modelCard('bad')),
          child(
            node('div', ['arrow'], {
              attributes: attrs({ ariaHidden: 'true' }),
              text: 'any',
            })
          ),
          child(modelCard('good')),
        ],
      })
    ),
    child(
      node('ol', ['steps'], {
        children: [repeated(learningStep, 5, 5)],
      })
    ),
  ],
});

const ADAPTER_CONTRACTS = Object.freeze({
  'mogu-note': moguRoot,
  'shroomdog-note': shroomdogRoot,
  toggle: toggleRoot,
  'level-up-progress': progressRoot,
  'level-up-quiz': quizRoot,
  'analogy-box': analogyRoot,
  mermaid: mermaidRoot,
  'post-image': postImageRoot,
  'diff-block': diffRoot,
  'codex-learning-map': learningMapRoot,
});

/**
 * Asserts the complete build-time DOM contract for one rendered Markdown adapter.
 * Authored descendants are opaque only inside the four registered content roots.
 */
export function assertRenderedAdapterDomContract(
  adapterRoot,
  { sourceName = '<rendered post>' } = {}
) {
  if (adapterRoot?.type !== 'element') {
    fail(sourceName, `adapter root must be an element, got ${describe(adapterRoot)}`);
  }
  const adapter = adapterRoot.properties?.dataMarkdownAdapter;
  if (typeof adapter !== 'string' || adapter.length === 0) {
    fail(sourceName, `${describe(adapterRoot)} is missing dataMarkdownAdapter`);
  }
  const contract = ADAPTER_CONTRACTS[adapter];
  if (!contract) fail(sourceName, `unknown rendered adapter ${adapter}`);
  assertNode(adapterRoot, contract, sourceName, `${adapter}`);
}
