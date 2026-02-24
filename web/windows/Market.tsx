
import React from 'react';

const MARKET_ITEMS = [
  { title: 'SQLite Explorer', desc: 'Query and browse local SQLite databases with natural language.', icon: 'database', color: 'from-blue-500 to-indigo-600' },
  { title: 'Calendar Sync', desc: 'Manage your Google and Outlook schedules automatically.', icon: 'calendar_month', color: 'from-green-500 to-emerald-600' },
  { title: 'Slack Notifier', desc: 'Push gateway alerts and data summaries to Slack channels.', icon: 'chat_bubble', color: 'from-orange-500 to-red-600' },
  { title: 'Weather Service', desc: 'Real-time local weather data and forecast automation.', icon: 'cloud', color: 'from-purple-500 to-pink-600' },
];

const Market: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-transparent transition-colors">
      <div className="flex flex-col items-center gap-4 py-4 px-8 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
        <div className="flex h-9 w-[480px] items-center justify-center rounded-lg bg-slate-200/50 dark:bg-white/5 p-1 border border-slate-300 dark:border-white/10">
          <button className="flex-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Installed</button>
          <button className="flex-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Available</button>
          <button className="flex-1 text-[11px] font-bold text-slate-800 dark:text-white bg-white dark:bg-white/10 rounded-md shadow-sm">Marketplace</button>
          <button className="flex-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Local</button>
        </div>
        <div className="relative w-[320px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 text-lg">search</span>
          <input className="block w-full pl-10 pr-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm placeholder-slate-400 dark:placeholder-white/40 focus:ring-1 focus:ring-primary outline-none text-slate-800 dark:text-white" placeholder="Search MCP servers..." />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <h2 className="text-lg font-bold tracking-tight mb-4 px-1 text-slate-800 dark:text-white">Featured Skills</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {MARKET_ITEMS.map(item => (
            <div key={item.title} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition-all cursor-pointer group shadow-sm">
              <div className={`w-14 h-14 bg-gradient-to-br ${item.color} rounded-xl mb-4 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                <span className="material-symbols-outlined text-3xl text-white">{item.icon}</span>
              </div>
              <h3 className="font-semibold text-sm mb-1 text-slate-800 dark:text-white">{item.title}</h3>
              <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed mb-4 line-clamp-2">{item.desc}</p>
              <button className="w-full bg-primary text-white text-xs font-bold py-1.5 rounded-lg hover:bg-blue-600 transition-colors shadow-md shadow-primary/20">Install</button>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-bold tracking-tight mb-4 px-1 text-slate-800 dark:text-white">Popular Servers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex items-center gap-4 bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-all group shadow-sm">
              <div className="w-16 h-16 rounded-lg bg-slate-200 dark:bg-[#2c2c2e] flex items-center justify-center shrink-0 border border-slate-300 dark:border-white/10">
                <span className="material-symbols-outlined text-slate-400 dark:text-white/60">terminal</span>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm text-slate-800 dark:text-white">Server Module {i}</h4>
                <p className="text-xs text-slate-400 dark:text-white/40 truncate">Essential tool for system operations.</p>
              </div>
              <button className="bg-primary/10 dark:bg-primary/20 hover:bg-primary text-primary hover:text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all">Get</button>
            </div>
          ))}
        </div>
      </div>

      <div className="h-10 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-white/40 font-bold uppercase tracking-widest">
          <span>Total Skills: 42</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-white/20"></span>
          <span>Marketplace: Online</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400 dark:text-white/40 font-medium">Automatic Updates</span>
          <div className="w-6 h-3 bg-primary rounded-full relative ml-2">
            <div className="absolute right-0.5 top-0.5 w-2 h-2 bg-white rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Market;
