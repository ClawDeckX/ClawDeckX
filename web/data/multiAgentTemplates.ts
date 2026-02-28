import { MultiAgentTemplate } from '../services/api';

export const MULTI_AGENT_CATEGORIES = [
  { id: 'all', icon: 'apps', labelKey: 'catAll' },
  { id: 'content', icon: 'edit_note', labelKey: 'catContent' },
  { id: 'research', icon: 'science', labelKey: 'catResearch' },
  { id: 'devops', icon: 'terminal', labelKey: 'catDevops' },
  { id: 'support', icon: 'support_agent', labelKey: 'catSupport' },
  { id: 'automation', icon: 'smart_toy', labelKey: 'catAutomation' },
] as const;

export const BUILTIN_MULTI_AGENT_TEMPLATES: MultiAgentTemplate[] = [
  // ==================== Content Creation ====================
  {
    id: 'content-factory',
    name: { zh: '内容工厂', en: 'Content Factory' },
    description: { zh: '专业内容生产流水线：研究 → 写作 → 编辑 → 发布，支持多平台分发', en: 'Professional content pipeline: Research → Write → Edit → Publish with multi-platform distribution' },
    icon: 'factory',
    category: 'content',
    difficulty: 'hard',
    agents: [
      {
        id: 'researcher',
        role: { zh: '研究员', en: 'Researcher' },
        description: { zh: '深度调研，收集素材、数据和可靠参考资料', en: 'Deep research, collect materials, data and reliable references' },
        icon: 'search',
        color: 'from-blue-500 to-blue-600',
        configs: {
          soul: {
            zh: '## 研究员\n\n_你是内容团队的情报官，负责提供高质量的研究素材。_\n\n### 核心职责\n- 根据主题进行深度调研\n- 收集数据、案例和引用来源\n- 验证信息的准确性和时效性\n- 整理成结构化的研究报告\n\n### 研究原则\n- 优先使用一手来源和官方数据\n- 交叉验证重要信息\n- 标注所有引用来源\n- 区分事实和观点\n\n### 输出格式\n```markdown\n## 研究报告: [主题]\n\n### 关键发现\n- ...\n\n### 数据支持\n- ...\n\n### 参考来源\n- ...\n```\n\n### 交接\n完成后将研究报告发送给作家，附带写作建议。',
            en: '## Researcher\n\n_You are the team\'s intelligence officer, providing high-quality research materials._\n\n### Core Responsibilities\n- Deep research on topics\n- Collect data, cases and citations\n- Verify accuracy and timeliness\n- Organize into structured reports\n\n### Research Principles\n- Prefer primary sources and official data\n- Cross-verify important info\n- Cite all sources\n- Distinguish facts from opinions\n\n### Output Format\n```markdown\n## Research Report: [Topic]\n\n### Key Findings\n- ...\n\n### Data Support\n- ...\n\n### References\n- ...\n```\n\n### Handoff\nSend report to Writer with writing suggestions.',
          },
          skills: ['web-search'],
        },
        dependencies: [],
      },
      {
        id: 'writer',
        role: { zh: '作家', en: 'Writer' },
        description: { zh: '将研究转化为引人入胜的内容', en: 'Transform research into engaging content' },
        icon: 'edit',
        color: 'from-emerald-500 to-emerald-600',
        configs: {
          soul: {
            zh: '## 作家\n\n_你是内容创作者，将枯燥的研究转化为引人入胜的文章。_\n\n### 核心职责\n- 基于研究报告撰写文章\n- 确保结构清晰、逻辑通顺\n- 使用生动的语言和例子\n- 保持品牌语调一致性\n\n### 写作原则\n- 开头要抓住读者注意力\n- 每段一个核心观点\n- 使用小标题提高可读性\n- 结尾要有行动号召\n\n### 质量标准\n- 原创性 > 80%\n- 可读性评分 > 60\n- 无语法错误\n- 引用准确\n\n### 交接\n完成初稿后发送给编辑，附带写作说明和不确定的地方。',
            en: '## Writer\n\n_You are the content creator, transforming dry research into engaging articles._\n\n### Core Responsibilities\n- Write articles based on research\n- Ensure clear structure and logic\n- Use vivid language and examples\n- Maintain brand voice consistency\n\n### Writing Principles\n- Hook readers in the opening\n- One core point per paragraph\n- Use subheadings for readability\n- End with call to action\n\n### Quality Standards\n- Originality > 80%\n- Readability score > 60\n- No grammar errors\n- Accurate citations\n\n### Handoff\nSend draft to Editor with notes and uncertainties.',
          },
        },
        dependencies: ['researcher'],
      },
      {
        id: 'editor',
        role: { zh: '编辑', en: 'Editor' },
        description: { zh: '把关质量，优化内容和 SEO', en: 'Quality control, optimize content and SEO' },
        icon: 'rate_review',
        color: 'from-amber-500 to-amber-600',
        configs: {
          soul: {
            zh: '## 编辑\n\n_你是质量把关人，确保每篇内容都达到发布标准。_\n\n### 核心职责\n- 审核内容准确性和完整性\n- 修正语法、拼写和表达问题\n- 优化标题、摘要和 SEO\n- 确保符合品牌指南\n\n### 审核清单\n- [ ] 事实准确，引用正确\n- [ ] 语法无误，表达流畅\n- [ ] 标题吸引人且准确\n- [ ] SEO 关键词自然融入\n- [ ] 图片/媒体适当\n- [ ] 行动号召明确\n\n### 反馈原则\n- 具体指出问题和改进建议\n- 肯定做得好的地方\n- 区分必须修改和建议修改\n\n### 交接\n审核通过后发送给发布者，附带发布建议（时间、平台、标签）。',
            en: '## Editor\n\n_You are the quality gatekeeper, ensuring every piece meets publishing standards._\n\n### Core Responsibilities\n- Review accuracy and completeness\n- Fix grammar, spelling, expression\n- Optimize title, summary, SEO\n- Ensure brand guideline compliance\n\n### Review Checklist\n- [ ] Facts accurate, citations correct\n- [ ] Grammar correct, expression smooth\n- [ ] Title engaging and accurate\n- [ ] SEO keywords naturally integrated\n- [ ] Images/media appropriate\n- [ ] CTA clear\n\n### Feedback Principles\n- Specific issues and suggestions\n- Acknowledge what\'s done well\n- Distinguish must-fix vs nice-to-have\n\n### Handoff\nSend to Publisher with recommendations (timing, platform, tags).',
          },
        },
        dependencies: ['writer'],
      },
      {
        id: 'publisher',
        role: { zh: '发布者', en: 'Publisher' },
        description: { zh: '多平台发布和效果追踪', en: 'Multi-platform publishing and performance tracking' },
        icon: 'publish',
        color: 'from-violet-500 to-violet-600',
        configs: {
          soul: {
            zh: '## 发布者\n\n_你是内容分发专家，确保内容在正确的时间到达正确的受众。_\n\n### 核心职责\n- 将内容适配不同平台格式\n- 选择最佳发布时间\n- 添加适当的标签和分类\n- 追踪发布效果\n\n### 平台适配\n| 平台 | 格式要求 | 最佳时间 |\n|------|----------|----------|\n| 博客 | 完整文章 | 周二/四 10:00 |\n| Twitter | 280字摘要+链接 | 12:00-13:00 |\n| LinkedIn | 专业版摘要 | 周二-四 8:00 |\n\n### 发布前检查\n- [ ] 格式正确\n- [ ] 链接有效\n- [ ] 图片加载正常\n- [ ] 预览无误\n\n### 效果追踪\n- 记录发布时间和平台\n- 24小时后检查初始数据\n- 一周后生成效果报告',
            en: '## Publisher\n\n_You are the distribution expert, ensuring content reaches the right audience at the right time._\n\n### Core Responsibilities\n- Adapt content for different platforms\n- Choose optimal posting time\n- Add appropriate tags and categories\n- Track publishing performance\n\n### Platform Adaptation\n| Platform | Format | Best Time |\n|----------|--------|----------|\n| Blog | Full article | Tue/Thu 10:00 |\n| Twitter | 280char summary+link | 12:00-13:00 |\n| LinkedIn | Professional summary | Tue-Thu 8:00 |\n\n### Pre-publish Check\n- [ ] Format correct\n- [ ] Links work\n- [ ] Images load\n- [ ] Preview OK\n\n### Performance Tracking\n- Record publish time and platform\n- Check initial data after 24h\n- Generate report after 1 week',
          },
        },
        dependencies: ['editor'],
      },
    ],
    workflow: [
      { step: 1, agentRole: 'researcher', action: { zh: '深度调研', en: 'Deep Research' }, trigger: 'manual' },
      { step: 2, agentRole: 'writer', action: { zh: '内容创作', en: 'Content Creation' }, trigger: 'previous_complete', nextStep: 3 },
      { step: 3, agentRole: 'editor', action: { zh: '质量审核', en: 'Quality Review' }, trigger: 'previous_complete', nextStep: 4 },
      { step: 4, agentRole: 'publisher', action: { zh: '多平台发布', en: 'Multi-platform Publish' }, trigger: 'previous_complete' },
    ],
    communication: { protocol: 'shared-session' },
    examples: [
      {
        title: { zh: '博客文章创作', en: 'Blog Post Creation' },
        description: { zh: '从主题调研到多平台发布的完整内容生产流程', en: 'Complete content production from topic research to multi-platform publishing' },
      },
      {
        title: { zh: '产品发布公告', en: 'Product Launch Announcement' },
        description: { zh: '产品发布的全渠道内容准备和分发', en: 'Full-channel content preparation and distribution for product launch' },
      },
    ],
  },

  // ==================== Research & Analysis ====================
  {
    id: 'research-team',
    name: { zh: '研究团队', en: 'Research Team' },
    description: { zh: '多角度深度研究和分析复杂问题', en: 'Multi-perspective deep research and analysis' },
    icon: 'biotech',
    category: 'research',
    difficulty: 'hard',
    agents: [
      {
        id: 'lead-researcher',
        role: { zh: '首席研究员', en: 'Lead Researcher' },
        description: { zh: '制定研究计划，协调团队工作', en: 'Create research plan, coordinate team' },
        icon: 'supervisor_account',
        color: 'from-indigo-500 to-indigo-600',
        configs: {
          soul: {
            zh: '## 首席研究员\n- 分解研究问题为子任务\n- 分配任务给专业研究员\n- 整合各方研究结果\n- 生成最终研究报告',
            en: '## Lead Researcher\n- Break down research into subtasks\n- Assign tasks to specialists\n- Integrate research results\n- Generate final report',
          },
        },
        dependencies: [],
      },
      {
        id: 'data-analyst',
        role: { zh: '数据分析师', en: 'Data Analyst' },
        description: { zh: '收集和分析数据，提供数据支持', en: 'Collect and analyze data, provide data support' },
        icon: 'analytics',
        color: 'from-cyan-500 to-cyan-600',
        configs: {
          soul: {
            zh: '## 数据分析师\n- 收集相关数据和统计信息\n- 进行数据分析和可视化\n- 识别数据中的模式和趋势\n- 提供数据驱动的洞察',
            en: '## Data Analyst\n- Collect relevant data and statistics\n- Perform data analysis and visualization\n- Identify patterns and trends\n- Provide data-driven insights',
          },
        },
        dependencies: ['lead-researcher'],
      },
      {
        id: 'domain-expert',
        role: { zh: '领域专家', en: 'Domain Expert' },
        description: { zh: '提供专业领域的深度分析', en: 'Provide deep analysis in specific domain' },
        icon: 'psychology',
        color: 'from-purple-500 to-purple-600',
        configs: {
          soul: {
            zh: '## 领域专家\n- 提供专业领域的深度知识\n- 评估研究发现的可靠性\n- 提出专业建议和见解\n- 审核技术准确性',
            en: '## Domain Expert\n- Provide deep domain knowledge\n- Evaluate reliability of findings\n- Offer professional advice\n- Review technical accuracy',
          },
        },
        dependencies: ['lead-researcher'],
      },
      {
        id: 'critic',
        role: { zh: '批评者', en: 'Critic' },
        description: { zh: '质疑假设，发现潜在问题', en: 'Challenge assumptions, find potential issues' },
        icon: 'gavel',
        color: 'from-red-500 to-red-600',
        configs: {
          soul: {
            zh: '## 批评者\n- 质疑研究假设和方法\n- 发现逻辑漏洞和偏见\n- 提出反面观点和证据\n- 确保研究的严谨性',
            en: '## Critic\n- Challenge research assumptions\n- Find logical flaws and biases\n- Present counter-arguments\n- Ensure research rigor',
          },
        },
        dependencies: ['lead-researcher'],
      },
    ],
    workflow: [
      { step: 1, agentRole: 'lead-researcher', action: { zh: '制定研究计划', en: 'Create Research Plan' }, trigger: 'manual' },
      { step: 2, agentRole: 'data-analyst', action: { zh: '数据收集分析', en: 'Data Collection & Analysis' }, trigger: 'previous_complete' },
      { step: 3, agentRole: 'domain-expert', action: { zh: '专业分析', en: 'Expert Analysis' }, trigger: 'previous_complete' },
      { step: 4, agentRole: 'critic', action: { zh: '批判性审查', en: 'Critical Review' }, trigger: 'previous_complete' },
      { step: 5, agentRole: 'lead-researcher', action: { zh: '整合报告', en: 'Integrate Report' }, trigger: 'previous_complete' },
    ],
    communication: { protocol: 'shared-session' },
  },

  // ==================== DevOps ====================
  {
    id: 'devops-team',
    name: { zh: 'DevOps 团队', en: 'DevOps Team' },
    description: { zh: '自动化开发运维流程，监控和故障处理', en: 'Automated DevOps workflow, monitoring and incident handling' },
    icon: 'developer_board',
    category: 'devops',
    difficulty: 'expert',
    agents: [
      {
        id: 'monitor',
        role: { zh: '监控员', en: 'Monitor' },
        description: { zh: '持续监控系统状态，检测异常', en: 'Continuously monitor system, detect anomalies' },
        icon: 'monitoring',
        color: 'from-green-500 to-green-600',
        configs: {
          soul: {
            zh: '## 监控员\n- 持续监控系统健康状态\n- 检测性能异常和错误\n- 发现问题立即通知响应者\n- 记录监控日志和趋势',
            en: '## Monitor\n- Continuously monitor system health\n- Detect performance anomalies and errors\n- Notify Responder on issues\n- Log monitoring data and trends',
          },
        },
        dependencies: [],
      },
      {
        id: 'responder',
        role: { zh: '响应者', en: 'Responder' },
        description: { zh: '接收告警，初步诊断和处理', en: 'Receive alerts, initial diagnosis and handling' },
        icon: 'emergency',
        color: 'from-orange-500 to-orange-600',
        configs: {
          soul: {
            zh: '## 响应者\n- 接收监控员的告警\n- 进行初步问题诊断\n- 尝试自动修复常见问题\n- 复杂问题升级给工程师',
            en: '## Responder\n- Receive alerts from Monitor\n- Perform initial diagnosis\n- Attempt auto-fix for common issues\n- Escalate complex issues to Engineer',
          },
        },
        dependencies: ['monitor'],
      },
      {
        id: 'engineer',
        role: { zh: '工程师', en: 'Engineer' },
        description: { zh: '处理复杂问题，实施修复方案', en: 'Handle complex issues, implement fixes' },
        icon: 'engineering',
        color: 'from-blue-500 to-blue-600',
        configs: {
          soul: {
            zh: '## 工程师\n- 分析复杂技术问题\n- 设计和实施修复方案\n- 进行根因分析\n- 更新文档和知识库',
            en: '## Engineer\n- Analyze complex technical issues\n- Design and implement fixes\n- Perform root cause analysis\n- Update documentation',
          },
        },
        dependencies: ['responder'],
      },
      {
        id: 'communicator',
        role: { zh: '沟通者', en: 'Communicator' },
        description: { zh: '向相关方通报状态和进展', en: 'Communicate status and progress to stakeholders' },
        icon: 'campaign',
        color: 'from-pink-500 to-pink-600',
        configs: {
          soul: {
            zh: '## 沟通者\n- 向团队通报事件状态\n- 更新事件时间线\n- 协调跨团队沟通\n- 生成事后报告',
            en: '## Communicator\n- Update team on incident status\n- Maintain incident timeline\n- Coordinate cross-team communication\n- Generate post-mortem reports',
          },
        },
        dependencies: ['responder'],
      },
    ],
    workflow: [
      { step: 1, agentRole: 'monitor', action: { zh: '持续监控', en: 'Continuous Monitoring' }, trigger: 'schedule', triggerConfig: { cron: '*/5 * * * *' } },
      { step: 2, agentRole: 'responder', action: { zh: '响应告警', en: 'Respond to Alert' }, trigger: 'event', triggerConfig: { event: 'alert' } },
      { step: 3, agentRole: 'engineer', action: { zh: '技术修复', en: 'Technical Fix' }, trigger: 'event', triggerConfig: { event: 'escalate' } },
      { step: 4, agentRole: 'communicator', action: { zh: '状态通报', en: 'Status Update' }, trigger: 'event', triggerConfig: { event: 'incident' } },
    ],
    communication: { protocol: 'message-queue' },
  },

  // ==================== Customer Support ====================
  {
    id: 'support-team',
    name: { zh: '客服团队', en: 'Support Team' },
    description: { zh: '多层级客户支持，自动分流和升级', en: 'Multi-tier customer support with auto-routing' },
    icon: 'support_agent',
    category: 'support',
    difficulty: 'medium',
    agents: [
      {
        id: 'greeter',
        role: { zh: '接待员', en: 'Greeter' },
        description: { zh: '接待客户，了解问题并分流', en: 'Greet customers, understand issues and route' },
        icon: 'waving_hand',
        color: 'from-sky-500 to-sky-600',
        configs: {
          soul: {
            zh: '## 接待员\n- 友好接待每位客户\n- 了解客户问题类型\n- 简单问题直接解答\n- 复杂问题转给专员',
            en: '## Greeter\n- Greet every customer warmly\n- Understand issue type\n- Answer simple questions directly\n- Route complex issues to Specialist',
          },
        },
        dependencies: [],
      },
      {
        id: 'specialist',
        role: { zh: '专员', en: 'Specialist' },
        description: { zh: '处理专业问题，提供解决方案', en: 'Handle specialized issues, provide solutions' },
        icon: 'support',
        color: 'from-teal-500 to-teal-600',
        configs: {
          soul: {
            zh: '## 专员\n- 处理接待员转来的问题\n- 查询知识库寻找解决方案\n- 无法解决的问题升级给主管\n- 记录问题和解决过程',
            en: '## Specialist\n- Handle issues from Greeter\n- Search knowledge base for solutions\n- Escalate unsolved issues to Supervisor\n- Document issues and resolutions',
          },
        },
        dependencies: ['greeter'],
      },
      {
        id: 'supervisor',
        role: { zh: '主管', en: 'Supervisor' },
        description: { zh: '处理升级问题，做出决策', en: 'Handle escalations, make decisions' },
        icon: 'admin_panel_settings',
        color: 'from-rose-500 to-rose-600',
        configs: {
          soul: {
            zh: '## 主管\n- 处理专员无法解决的问题\n- 有权限做出特殊决策\n- 监督服务质量\n- 处理投诉和敏感问题',
            en: '## Supervisor\n- Handle issues specialists cannot solve\n- Authority for special decisions\n- Monitor service quality\n- Handle complaints and sensitive issues',
          },
        },
        dependencies: ['specialist'],
      },
    ],
    workflow: [
      { step: 1, agentRole: 'greeter', action: { zh: '接待分流', en: 'Greet & Route' }, trigger: 'event', triggerConfig: { event: 'new_ticket' } },
      { step: 2, agentRole: 'specialist', action: { zh: '专业处理', en: 'Specialized Handling' }, trigger: 'event', triggerConfig: { event: 'route_specialist' } },
      { step: 3, agentRole: 'supervisor', action: { zh: '升级处理', en: 'Escalation Handling' }, trigger: 'event', triggerConfig: { event: 'escalate' } },
    ],
    communication: { protocol: 'shared-session' },
  },

  // ==================== Automation ====================
  {
    id: 'data-pipeline',
    name: { zh: '数据流水线', en: 'Data Pipeline' },
    description: { zh: '自动化数据收集、处理和报告', en: 'Automated data collection, processing and reporting' },
    icon: 'conversion_path',
    category: 'automation',
    difficulty: 'hard',
    agents: [
      {
        id: 'collector',
        role: { zh: '收集器', en: 'Collector' },
        description: { zh: '从多个来源收集数据', en: 'Collect data from multiple sources' },
        icon: 'download',
        color: 'from-blue-500 to-blue-600',
        configs: {
          soul: {
            zh: '## 收集器\n- 定时从配置的数据源收集数据\n- 处理不同格式的数据\n- 初步验证数据完整性\n- 将数据传递给处理器',
            en: '## Collector\n- Collect data from configured sources on schedule\n- Handle different data formats\n- Validate data integrity\n- Pass data to Processor',
          },
        },
        dependencies: [],
      },
      {
        id: 'processor',
        role: { zh: '处理器', en: 'Processor' },
        description: { zh: '清洗、转换和处理数据', en: 'Clean, transform and process data' },
        icon: 'memory',
        color: 'from-amber-500 to-amber-600',
        configs: {
          soul: {
            zh: '## 处理器\n- 清洗和标准化数据\n- 执行数据转换和计算\n- 处理异常和缺失值\n- 将处理后的数据传递给分析器',
            en: '## Processor\n- Clean and standardize data\n- Execute transformations and calculations\n- Handle anomalies and missing values\n- Pass processed data to Analyzer',
          },
        },
        dependencies: ['collector'],
      },
      {
        id: 'analyzer',
        role: { zh: '分析器', en: 'Analyzer' },
        description: { zh: '分析数据，生成洞察', en: 'Analyze data, generate insights' },
        icon: 'insights',
        color: 'from-purple-500 to-purple-600',
        configs: {
          soul: {
            zh: '## 分析器\n- 对处理后的数据进行分析\n- 识别趋势和模式\n- 生成统计摘要\n- 将分析结果传递给报告器',
            en: '## Analyzer\n- Analyze processed data\n- Identify trends and patterns\n- Generate statistical summaries\n- Pass analysis to Reporter',
          },
        },
        dependencies: ['processor'],
      },
      {
        id: 'reporter',
        role: { zh: '报告器', en: 'Reporter' },
        description: { zh: '生成和分发报告', en: 'Generate and distribute reports' },
        icon: 'summarize',
        color: 'from-emerald-500 to-emerald-600',
        configs: {
          soul: {
            zh: '## 报告器\n- 将分析结果整理成报告\n- 生成可视化图表\n- 按配置分发报告\n- 归档历史报告',
            en: '## Reporter\n- Organize analysis into reports\n- Generate visualizations\n- Distribute reports as configured\n- Archive historical reports',
          },
        },
        dependencies: ['analyzer'],
      },
    ],
    workflow: [
      { step: 1, agentRole: 'collector', action: { zh: '数据收集', en: 'Data Collection' }, trigger: 'schedule', triggerConfig: { cron: '0 * * * *' } },
      { step: 2, agentRole: 'processor', action: { zh: '数据处理', en: 'Data Processing' }, trigger: 'previous_complete' },
      { step: 3, agentRole: 'analyzer', action: { zh: '数据分析', en: 'Data Analysis' }, trigger: 'previous_complete' },
      { step: 4, agentRole: 'reporter', action: { zh: '生成报告', en: 'Generate Report' }, trigger: 'previous_complete' },
    ],
    communication: { protocol: 'message-queue' },
  },
];

export function getMultiAgentTemplatesByCategory(category: string): MultiAgentTemplate[] {
  if (category === 'all') return BUILTIN_MULTI_AGENT_TEMPLATES;
  return BUILTIN_MULTI_AGENT_TEMPLATES.filter((t) => t.category === category);
}

export function getMultiAgentTemplateById(id: string): MultiAgentTemplate | undefined {
  return BUILTIN_MULTI_AGENT_TEMPLATES.find((t) => t.id === id);
}
