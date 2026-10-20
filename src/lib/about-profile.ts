import profile from '../data/about-profile.json';

export type AboutLang = 'zh-tw' | 'en';

export type AboutProfileData = {
  name: Record<AboutLang, string>;
  role: Record<AboutLang, string>;
  bio: Record<AboutLang, string>;
  links: {
    github: string;
    repo: string;
    linkedin: string;
    x: string;
    email: string;
  };
};

export type AboutLink = { key: keyof AboutProfileData['links']; label: string; href: string };

const LINK_LABELS: Record<AboutLang, Record<keyof AboutProfileData['links'], string>> = {
  'zh-tw': {
    github: 'GitHub',
    repo: 'gu-log 原始碼',
    linkedin: 'LinkedIn',
    x: 'X',
    email: 'Email',
  },
  en: {
    github: 'GitHub',
    repo: 'gu-log source code',
    linkedin: 'LinkedIn',
    x: 'X',
    email: 'Email',
  },
};

const LINK_ORDER: (keyof AboutProfileData['links'])[] = [
  'github',
  'repo',
  'linkedin',
  'x',
  'email',
];

/**
 * 中英 About 頁共用的個人資料。空字串欄位（bio、linkedin、x、email）不顯示，
 * 站長填進 src/data/about-profile.json 之後才會出現。
 */
export function getAboutProfile(lang: AboutLang, data: AboutProfileData = profile) {
  const links: AboutLink[] = LINK_ORDER.flatMap((key) => {
    const value = data.links[key].trim();
    if (!value) return [];
    const href = key === 'email' && !value.startsWith('mailto:') ? `mailto:${value}` : value;
    return [{ key, label: LINK_LABELS[lang][key], href }];
  });
  return {
    name: data.name[lang],
    role: data.role[lang],
    bio: data.bio[lang].trim(),
    links,
  };
}
