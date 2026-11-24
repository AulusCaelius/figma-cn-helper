/**
 * Figma 中文汉化助手 - 动态文本正则规则
 * 处理含时间、数量、动态名称的 Figma UI 文案。
 */
(function (global) {
  "use strict";

  const UNIT_MAP = {
    second: "秒",
    seconds: "秒",
    sec: "秒",
    secs: "秒",
    minute: "分钟",
    minutes: "分钟",
    min: "分钟",
    mins: "分钟",
    hour: "小时",
    hours: "小时",
    hr: "小时",
    hrs: "小时",
    day: "天",
    days: "天",
    week: "周",
    weeks: "周",
    month: "个月",
    months: "个月",
    year: "年",
    years: "年"
  };

  const VERB_MAP = {
    Edited: "编辑",
    Viewed: "查看",
    Created: "创建",
    Updated: "更新",
    Modified: "修改",
    Published: "发布",
    Saved: "保存",
    Deleted: "删除",
    Shared: "共享",
    Opened: "打开"
  };

  function unitCN(u) {
    return UNIT_MAP[u.toLowerCase()] || u;
  }

  const REGEX_RULES = [
    // "Edited just now" / "Saved just now"
    {
      pattern: /^(Edited|Viewed|Created|Updated|Modified|Published|Saved|Deleted|Shared|Opened)\s+just now$/i,
      replace: (_, verb) => {
        const key = verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase();
        return `刚刚${VERB_MAP[key] || verb}`;
      }
    },
    // "Edited 2 hours ago" / "Viewed 1 day ago"
    {
      pattern: /^(Edited|Viewed|Created|Updated|Modified|Published|Saved|Deleted|Shared|Opened)\s+(\d+|a|an)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago$/i,
      replace: (_, verb, count, unit) => {
        const key = verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase();
        const num = count.toLowerCase() === "a" || count.toLowerCase() === "an" ? "1" : count;
        return `${num} ${unitCN(unit)}前${VERB_MAP[key] || verb}`;
      }
    },
    // "Edited yesterday"
    {
      pattern: /^(Edited|Viewed|Created|Updated|Modified|Published|Saved)\s+yesterday$/i,
      replace: (_, verb) => {
        const key = verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase();
        return `昨天${VERB_MAP[key] || verb}`;
      }
    },
    // "2 hours ago" / "a minute ago"
    {
      pattern: /^(\d+|a|an)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago$/i,
      replace: (_, count, unit) => {
        const num = count.toLowerCase() === "a" || count.toLowerCase() === "an" ? "1" : count;
        return `${num} ${unitCN(unit)}前`;
      }
    },
    // "Export 3 layers" / "Export 1 layer"
    {
      pattern: /^Export\s+(\d+)\s+layers?$/i,
      replace: (_, n) => `导出 ${n} 个图层`
    },
    // "Export Frame 1" -> keep target name intact
    {
      pattern: /^Export\s+(.+)$/,
      replace: (_, target) => `导出 ${target}`
    },
    // "3 files" / "1 file"
    {
      pattern: /^(\d+)\s+files?$/i,
      replace: (_, n) => `${n} 个文件`
    },
    // "3 projects" / "1 project"
    {
      pattern: /^(\d+)\s+projects?$/i,
      replace: (_, n) => `${n} 个项目`
    },
    // "3 folders" / "1 folder"
    {
      pattern: /^(\d+)\s+folders?$/i,
      replace: (_, n) => `${n} 个文件夹`
    },
    // "3 members" / "1 member"
    {
      pattern: /^(\d+)\s+members?$/i,
      replace: (_, n) => `${n} 位成员`
    },
    // "3 comments" / "1 comment"
    {
      pattern: /^(\d+)\s+comments?$/i,
      replace: (_, n) => `${n} 条评论`
    },
    // "3 replies" / "1 reply"
    {
      pattern: /^(\d+)\s+(?:reply|replies)$/i,
      replace: (_, n) => `${n} 条回复`
    },
    // "3 updates" / "1 update"
    {
      pattern: /^(\d+)\s+updates?$/i,
      replace: (_, n) => `${n} 个更新`
    },
    // "3 components" / "1 component"
    {
      pattern: /^(\d+)\s+components?$/i,
      replace: (_, n) => `${n} 个组件`
    },
    // "3 variables" / "1 variable"
    {
      pattern: /^(\d+)\s+variables?$/i,
      replace: (_, n) => `${n} 个变量`
    },
    // "3 styles" / "1 style"
    {
      pattern: /^(\d+)\s+styles?$/i,
      replace: (_, n) => `${n} 个样式`
    },
    // "5 selected"
    {
      pattern: /^(\d+)\s+selected$/i,
      replace: (_, n) => `已选中 ${n} 项`
    },
    // "Show 5 more"
    {
      pattern: /^Show\s+(\d+)\s+more$/i,
      replace: (_, n) => `再显示 ${n} 项`
    },
    // "Zoom to 50%"
    {
      pattern: /^Zoom to\s+(\d+%)$/i,
      replace: (_, pct) => `缩放至 ${pct}`
    },
    // "Search in XXX"
    {
      pattern: /^Search in\s+(.+)$/,
      replace: (_, scope) => `在 ${scope} 中搜索`
    },
    // "Move to XXX"
    {
      pattern: /^Move to\s+(.+)$/,
      replace: (_, dest) => `移动到 ${dest}`
    },
    // "Open in XXX"
    {
      pattern: /^Open in\s+(.+)$/,
      replace: (_, dest) => `在 ${dest} 中打开`
    }
  ];

  global.__FIGMA_CN_REGEX_RULES__ = REGEX_RULES;
})(typeof window !== "undefined" ? window : globalThis);
