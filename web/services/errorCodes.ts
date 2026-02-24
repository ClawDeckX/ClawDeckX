// Error code → localized message mapping.
// Backend returns English-only `error_code`; this table provides zh/en translations.
// If a code is not found here, the backend's English `message` is used as fallback.

const errorMessages: Record<string, { zh: string; en: string }> = {
  // Auth
  AUTH_UNAUTHORIZED: { zh: '未登录或会话已过期', en: 'Not logged in or session expired' },
  AUTH_FORBIDDEN: { zh: '权限不足', en: 'Permission denied' },
  AUTH_INVALID_PASSWORD: { zh: '用户名或密码错误', en: 'Invalid username or password' },
  AUTH_ACCOUNT_LOCKED: { zh: '账户已锁定，请稍后再试', en: 'Account locked, try again later' },
  AUTH_TOKEN_EXPIRED: { zh: '会话已过期，请重新登录', en: 'Session expired, please login again' },
  AUTH_TOKEN_INVALID: { zh: '无效的令牌', en: 'Invalid token' },
  AUTH_EMPTY_CREDENTIALS: { zh: '用户名和密码不能为空', en: 'Username and password required' },
  AUTH_PASSWORD_TOO_SHORT: { zh: '密码至少需要6位', en: 'Password must be at least 6 characters' },
  AUTH_SETUP_DONE: { zh: '管理员账号已存在', en: 'Admin account already exists' },
  AUTH_OLD_PASSWORD_WRONG: { zh: '原密码错误', en: 'Old password incorrect' },
  AUTH_LOGIN_FAILED: { zh: '登录失败', en: 'Login failed' },

  // System / generic
  NOT_FOUND: { zh: '资源不存在', en: 'Resource not found' },
  INVALID_PARAM: { zh: '请求参数无效', en: 'Invalid request parameter' },
  INVALID_BODY: { zh: '请求格式无效', en: 'Invalid request body' },
  INTERNAL_ERROR: { zh: '服务器内部错误', en: 'Internal server error' },
  RATE_LIMITED: { zh: '请求过于频繁，请稍后再试', en: 'Too many requests, please try later' },
  INVALID_INPUT: { zh: '输入包含非法字符', en: 'Input contains illegal characters' },
  DB_QUERY_FAILED: { zh: '数据库查询失败', en: 'Database query failed' },
  ENCRYPT_FAILED: { zh: '加密失败', en: 'Encryption failed' },
  PATH_ERROR: { zh: '无法确定用户目录', en: 'Cannot determine user directory' },

  // User management
  USER_NOT_FOUND: { zh: '用户不存在', en: 'User not found' },
  USER_EXISTS: { zh: '用户名已存在', en: 'Username already exists' },
  USER_CREATE_FAILED: { zh: '用户创建失败', en: 'User creation failed' },
  USER_DELETE_FAILED: { zh: '用户删除失败', en: 'User deletion failed' },
  USER_QUERY_FAILED: { zh: '用户查询失败', en: 'User query failed' },
  USER_SELF_DELETE: { zh: '不能删除当前登录用户', en: 'Cannot delete current user' },

  // Gateway
  GW_NOT_CONNECTED: { zh: '网关未连接', en: 'Gateway not connected' },
  GW_NOT_RUNNING: { zh: '网关未运行', en: 'Gateway not running' },
  GW_START_FAILED: { zh: '网关启动失败', en: 'Gateway start failed' },
  GW_START_TIMEOUT: { zh: '网关启动超时', en: 'Gateway start timeout' },
  GW_STOP_FAILED: { zh: '网关停止失败', en: 'Gateway stop failed' },
  GW_STATUS_FAILED: { zh: '网关状态查询失败', en: 'Gateway status query failed' },
  GW_PROFILE_NOT_FOUND: { zh: '网关配置不存在', en: 'Gateway profile not found' },
  GW_PROFILE_SAVE_FAILED: { zh: '网关配置保存失败', en: 'Gateway profile save failed' },
  GW_PROFILE_DELETE_FAILED: { zh: '网关配置删除失败', en: 'Gateway profile delete failed' },
  GW_DIAGNOSE_FAILED: { zh: '网关诊断失败', en: 'Gateway diagnosis failed' },

  // Gateway proxy
  GW_PROXY_FAILED: { zh: '网关代理请求失败', en: 'Gateway proxy request failed' },
  GW_CONFIG_READ_FAILED: { zh: '配置读取失败', en: 'Config read failed' },
  GW_CONFIG_WRITE_FAILED: { zh: '配置写入失败', en: 'Config write failed' },
  GW_AGENTS_FAILED: { zh: '代理查询失败', en: 'Agents query failed' },
  GW_CHANNELS_FAILED: { zh: '频道查询失败', en: 'Channels query failed' },
  GW_MODELS_FAILED: { zh: '模型查询失败', en: 'Models query failed' },
  GW_SESSIONS_FAILED: { zh: '会话查询失败', en: 'Sessions query failed' },
  GW_SKILLS_FAILED: { zh: '技能查询失败', en: 'Skills query failed' },
  GW_USAGE_FAILED: { zh: '用量查询失败', en: 'Usage query failed' },
  GW_CRON_FAILED: { zh: '定时任务查询失败', en: 'Cron query failed' },
  GW_HEALTH_FAILED: { zh: '健康检查失败', en: 'Health check failed' },
  GW_CHAT_FAILED: { zh: '对话请求失败', en: 'Chat request failed' },
  GW_MODEL_TEST_FAILED: { zh: '模型测试失败', en: 'Model test failed' },
  MODEL_NO_API_KEY: { zh: '请先填写 API Key', en: 'Please enter API Key first' },
  MODEL_NO_MODEL: { zh: '请先选择模型', en: 'Please select a model first' },

  // Config
  CONFIG_PATH_ERROR: { zh: '无法确定配置文件路径', en: 'Cannot determine config file path' },
  CONFIG_NOT_FOUND: { zh: '配置文件不存在', en: 'Config file not found' },
  CONFIG_READ_FAILED: { zh: '配置读取失败', en: 'Config read failed' },
  CONFIG_WRITE_FAILED: { zh: '配置写入失败', en: 'Config write failed' },
  CONFIG_GEN_FAILED: { zh: '配置生成失败', en: 'Config generation failed' },
  CONFIG_EMPTY: { zh: '没有有效的配置项', en: 'No valid config entries' },

  // Security
  SECURITY_QUERY_FAILED: { zh: '规则查询失败', en: 'Rule query failed' },
  SECURITY_CREATE_FAILED: { zh: '规则创建失败', en: 'Rule creation failed' },
  SECURITY_UPDATE_FAILED: { zh: '规则更新失败', en: 'Rule update failed' },
  SECURITY_DELETE_FAILED: { zh: '规则删除失败', en: 'Rule deletion failed' },
  SECURITY_RULE_EXISTS: { zh: '规则 ID 已存在', en: 'Rule ID already exists' },
  SECURITY_BUILTIN_READONLY: { zh: '内置规则只读，只能启用/禁用', en: 'Builtin rules are read-only, can only be toggled' },

  // Backup
  BACKUP_NOT_FOUND: { zh: '备份记录不存在', en: 'Backup record not found' },
  BACKUP_FAILED: { zh: '备份失败', en: 'Backup failed' },
  BACKUP_RESTORE_FAILED: { zh: '备份恢复失败', en: 'Backup restore failed' },
  BACKUP_DELETE_FAILED: { zh: '备份删除失败', en: 'Backup deletion failed' },

  // Settings
  SETTINGS_QUERY_FAILED: { zh: '设置查询失败', en: 'Settings query failed' },
  SETTINGS_UPDATE_FAILED: { zh: '设置更新失败', en: 'Settings update failed' },

  // Skills
  SKILL_NOT_FOUND: { zh: '技能不存在', en: 'Skill not found' },
  SKILL_INSTALL_FAILED: { zh: '技能安装失败', en: 'Skill install failed' },
  SKILL_UNINSTALL_FAILED: { zh: '技能卸载失败', en: 'Skill uninstall failed' },
  SKILL_UPDATE_FAILED: { zh: '技能更新失败', en: 'Skill update failed' },
  SKILLS_READ_ERROR: { zh: '技能目录读取失败', en: 'Skills directory read failed' },
  SKILLS_PATH_ERROR: { zh: '无法确定用户目录', en: 'Cannot determine user directory' },

  // OpenClaw
  OPENCLAW_NOT_INSTALLED: { zh: 'OpenClaw 未安装', en: 'OpenClaw is not installed' },
  UNINSTALL_FAILED: { zh: '卸载失败', en: 'Uninstall failed' },
  INSTALL_FAILED: { zh: '安装失败', en: 'Install failed' },
  SCAN_ERROR: { zh: '环境扫描失败', en: 'Scan failed' },

  // Monitor
  MONITOR_NOT_RUNNING: { zh: '监控服务未运行', en: 'Monitor service not running' },
  LOG_READ_ERROR: { zh: '日志读取失败', en: 'Log read failed' },
  LOG_PARSE_ERROR: { zh: '日志解析失败', en: 'Log parse failed' },
  SSE_ERROR: { zh: 'SSE 流错误', en: 'SSE stream error' },

  // Alert / Activity / Audit / Export
  ALERT_NOT_FOUND: { zh: '告警不存在', en: 'Alert not found' },
  ALERT_QUERY_FAILED: { zh: '告警查询失败', en: 'Alert query failed' },
  ACTIVITY_NOT_FOUND: { zh: '活动不存在', en: 'Activity not found' },
  EXPORT_FAILED: { zh: '导出失败', en: 'Export failed' },

  // ClawHub
  CLAWHUB_FAILED: { zh: 'ClawHub 请求失败', en: 'ClawHub request failed' },

  // Router-level
  SYSTEM_METHOD_NOT_ALLOWED: { zh: '方法不允许', en: 'Method not allowed' },
};

type Lang = 'zh' | 'en';

function getLang(): Lang {
  const lang = localStorage.getItem('lang');
  return lang === 'en' ? 'en' : 'zh';
}

/**
 * Translate an error code to a localized message.
 * If the code has a detail suffix (e.g. "install failed: some reason"),
 * only the code part is translated and the detail is appended.
 */
export function translateErrorCode(code: string, fallbackMessage: string): string {
  const lang = getLang();
  const entry = errorMessages[code];
  if (entry) {
    return entry[lang];
  }
  // fallback: return backend message as-is
  return fallbackMessage;
}

/**
 * Translate a full error message that may contain a detail suffix after ": ".
 * The error_code is used for lookup; the detail from the backend message is preserved.
 */
export function translateApiError(code: string, message: string): string {
  const lang = getLang();
  const entry = errorMessages[code];
  if (!entry) return message;

  const translated = entry[lang];
  // If backend message has detail after the English fallback, append it
  const colonIdx = message.indexOf(': ');
  if (colonIdx > 0) {
    const detail = message.substring(colonIdx + 2);
    return `${translated}: ${detail}`;
  }
  return translated;
}
