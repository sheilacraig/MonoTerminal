import React from 'react';
import {
  Terminal,
  Bot,
  FolderTree,
  ShieldCheck,
  Zap,
  Lock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Play,
  Copy,
  Download,
  Cpu,
  Sparkles,
  FileCode
} from 'lucide-react';

const GithubIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 16,
  className = ''
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
);

interface LandingPageProps {
  onEnterDemo: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterDemo }) => {
  return (
    <div className="min-h-screen w-full bg-[#0d1117] text-[#c9d1d9] font-sans selection:bg-orca-accent/30 selection:text-white">
      {/* 1. Header Navbar */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-[#0d1117]/85 border-b border-[#30363d] px-6 py-3 flex items-center justify-between">
        <div
          className="flex items-center space-x-3 cursor-pointer"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Terminal size={18} />
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-white font-bold text-lg tracking-tight">MonoTerminal</span>
            <span className="text-[10px] bg-[#21262d] text-[#58a6ff] border border-[#30363d] px-1.5 py-0.5 rounded font-mono font-medium">
              v1.0.3
            </span>
          </div>
        </div>

        {/* Center links */}
        <div className="hidden md:flex items-center space-x-6 text-sm text-[#8b949e]">
          <a href="#features" className="hover:text-white transition-colors">
            核心特性
          </a>
          <a href="#comparison" className="hover:text-white transition-colors">
            痛点对比
          </a>
          <a href="#shortcuts" className="hover:text-white transition-colors">
            快捷键
          </a>
          <a href="#quickstart" className="hover:text-white transition-colors">
            快速运行
          </a>
          <a
            href="https://github.com/sheilacraig/MonoTerminal/blob/main/docs/PACKAGING.md"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white transition-colors"
          >
            打包指南
          </a>
        </div>

        {/* Right CTA */}
        <div className="flex items-center space-x-3">
          <a
            href="https://github.com/sheilacraig/MonoTerminal"
            target="_blank"
            rel="noreferrer"
            className="flex items-center space-x-1.5 text-xs text-[#8b949e] hover:text-white px-3 py-1.5 rounded-md hover:bg-[#21262d] border border-transparent hover:border-[#30363d] transition-all"
          >
            <GithubIcon size={15} />
            <span className="hidden sm:inline">GitHub</span>
          </a>

          <a
            href="https://github.com/sheilacraig/MonoTerminal/releases"
            target="_blank"
            rel="noreferrer"
            className="flex items-center space-x-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 rounded-md shadow-md shadow-blue-600/30 transition-all hover:scale-105 active:scale-95"
          >
            <Download size={13} />
            <span>下载客户端</span>
          </a>
        </div>
      </nav>

      {/* 2. Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-16 px-6 max-w-6xl mx-auto text-center">
        {/* Decorative background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute top-1/3 left-1/3 w-[300px] h-[250px] bg-purple-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

        {/* Top Badges */}
        <div className="inline-flex items-center space-x-2 bg-[#161b22] border border-[#30363d] px-3 py-1 rounded-full text-xs text-[#8b949e] mb-6 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white font-medium">零登录 · 100% 本地加密</span>
          <span className="text-[#30363d]">|</span>
          <span className="text-blue-400">AI 原生运维终端与 SFTP</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.15] mb-6">
          专为高效排障设计的 <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-blue-400 via-teal-300 to-purple-400 bg-clip-text text-transparent">
            AI 原生终端与 SFTP 客户端
          </span>
        </h1>

        {/* Hero Subtitle */}
        <p className="max-w-2xl mx-auto text-base sm:text-lg text-[#8b949e] leading-relaxed mb-10">
          告别在黑色终端、浏览器大模型与 SFTP 软件之间反复复制粘贴。报错自动感知，单键切换 AI
          诊断，一键回车落地执行，配置文件在线同步写回。
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 mb-16">
          <a
            href="https://github.com/sheilacraig/MonoTerminal/releases"
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto flex items-center justify-center space-x-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-6 py-3 rounded-lg shadow-xl shadow-blue-600/25 transition-all hover:scale-105 active:scale-95"
          >
            <Download size={16} />
            <span>下载 Windows 客户端 (.exe)</span>
            <ArrowRight size={16} />
          </a>

          <a
            href="https://github.com/sheilacraig/MonoTerminal"
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto flex items-center justify-center space-x-2 text-sm font-medium text-[#c9d1d9] bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] hover:border-[#8b949e] px-5 py-3 rounded-lg transition-all"
          >
            <GithubIcon size={16} />
            <span>GitHub 源码仓库</span>
          </a>

          <a
            href="#quickstart"
            className="w-full sm:w-auto flex items-center justify-center space-x-2 text-sm font-medium text-[#8b949e] hover:text-white px-4 py-3 rounded-lg hover:bg-[#161b22] transition-colors"
          >
            <Download size={16} />
            <span>本地启动指南</span>
          </a>
        </div>

        {/* 3. Hero Interactive App Mockup Preview */}
        <div className="relative mx-auto rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl overflow-hidden text-left font-mono">
          {/* Top Window Bar */}
          <div className="bg-[#0d1117] border-b border-[#30363d] px-4 py-2 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-[#f85149]" />
              <span className="w-3 h-3 rounded-full bg-[#d29922]" />
              <span className="w-3 h-3 rounded-full bg-[#3fb950]" />
              <span className="ml-2 text-xs text-[#8b949e] font-sans font-medium">
                MonoTerminal - prod-web01 (root@10.0.0.12)
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-[#8b949e]">
              <span className="bg-[#21262d] px-2 py-0.5 rounded text-[11px] text-[#58a6ff]">
                Ctrl + \ 穿梭模式
              </span>
              <span className="bg-[#21262d] px-2 py-0.5 rounded text-[11px] text-[#3fb950]">
                RTT: 12ms
              </span>
            </div>
          </div>

          {/* Body: 2 Columns */}
          <div className="grid grid-cols-1 md:grid-cols-12 h-[420px] bg-[#0d1117] text-xs">
            {/* Col 1: SFTP Tree (3 cols) */}
            <div className="hidden md:block md:col-span-3 border-r border-[#30363d] bg-[#161b22]/70 p-3 overflow-hidden">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#30363d] text-[#8b949e] text-[11px]">
                <div className="flex items-center space-x-1.5 font-sans font-semibold text-[#c9d1d9]">
                  <FolderTree size={13} className="text-blue-400" />
                  <span>SFTP 文件管理器</span>
                </div>
                <span className="text-[10px] text-[#8b949e]">Ctrl+B</span>
              </div>
              <div className="space-y-1.5 text-[11px] text-[#8b949e]">
                <div className="text-blue-400 font-semibold">📁 /etc/nginx</div>
                <div className="pl-3 text-yellow-400 flex items-center space-x-1">
                  <span>📁</span> <span>conf.d/</span>
                </div>
                <div className="pl-3 text-yellow-400 flex items-center space-x-1">
                  <span>📁</span> <span>ssl/</span>
                </div>
                <div className="pl-3 text-[#58a6ff] bg-[#21262d] py-0.5 px-1 rounded flex items-center space-x-1 border border-[#30363d]">
                  <FileCode size={12} />
                  <span className="text-white">nginx.conf</span>
                  <span className="ml-auto text-[9px] text-[#8b949e]">0644</span>
                </div>
                <div className="pl-3 text-[#c9d1d9] flex items-center space-x-1">
                  <span>📄</span> <span>mime.types</span>
                </div>
                <div className="text-blue-400 font-semibold pt-2">📁 /var/log/nginx</div>
                <div className="pl-3 text-red-400 flex items-center space-x-1">
                  <span>📄</span> <span>error.log</span>
                </div>
                <div className="pl-3 text-[#8b949e] flex items-center space-x-1">
                  <span>📄</span> <span>access.log</span>
                </div>
              </div>
            </div>

            {/* Col 2: Main Terminal + AI Panel Split (9 cols) */}
            <div className="col-span-1 md:col-span-9 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#30363d]">
              {/* Terminal Pane */}
              <div className="p-4 flex flex-col justify-between bg-[#0d1117] overflow-hidden">
                <div className="space-y-1.5 leading-relaxed text-[#c9d1d9]">
                  <div className="text-emerald-400">root@prod-web01:~# systemctl restart nginx</div>
                  <div className="text-red-400 font-medium">
                    Job for nginx.service failed because the control process exited with error code.
                  </div>
                  <div className="text-[#8b949e]">
                    root@prod-web01:~# tail -n 2 /var/log/nginx/error.log
                  </div>
                  <div className="text-red-400 bg-red-950/30 p-1.5 rounded border border-red-900/50">
                    2026/09/20 18:42:12 [emerg] 1042#1042: bind() to 0.0.0.0:80 failed (98: Address
                    already in use)
                  </div>
                  <div className="flex items-center text-emerald-400 pt-1">
                    <span>root@prod-web01:~#&nbsp;</span>
                    <span className="w-2 h-3.5 bg-blue-400 inline-block animate-pulse" />
                  </div>
                </div>

                {/* Floating Error Bubble */}
                <div className="mt-4 self-end bg-gradient-to-r from-red-600 to-amber-600 text-white px-3 py-1.5 rounded-full shadow-lg flex items-center space-x-2 text-[11px] animate-bounce">
                  <Zap size={12} />
                  <span className="font-sans font-semibold">检测到端口冲突报错 (Ctrl + \)</span>
                </div>
              </div>

              {/* AI Agent Pane */}
              <div className="p-4 flex flex-col justify-between bg-[#161b22]/50">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-[#30363d]">
                    <div className="flex items-center space-x-1.5 text-purple-400 font-sans font-semibold text-xs">
                      <Bot size={14} />
                      <span>AI 运维诊断 (DeepSeek-V3 / Ollama)</span>
                    </div>
                    <span className="text-[10px] text-emerald-400 font-medium bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                      已提取 50 行上下文
                    </span>
                  </div>

                  <div className="text-[11px] text-[#8b949e] font-sans leading-relaxed">
                    诊断结论：80 端口已被外部进程占用，导致 Nginx 无法完成 bind()
                    绑定。建议排查占用进程并释放端口。
                  </div>

                  {/* Actionable Command Card */}
                  <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-[#8b949e] font-sans">
                      <span>建议排查命令</span>
                      <span className="text-emerald-400">安全级别: LOW</span>
                    </div>
                    <div className="bg-[#161b22] px-2.5 py-1.5 rounded font-mono text-[#58a6ff] text-xs">
                      sudo lsof -i :80
                    </div>
                    <div className="flex items-center space-x-2 pt-1 font-sans">
                      <button
                        onClick={onEnterDemo}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-1 px-2 rounded text-[11px] flex items-center justify-center space-x-1 transition-colors"
                      >
                        <Play size={11} fill="currentColor" />
                        <span>↵ 立即运行并切回</span>
                      </button>
                      <button
                        onClick={onEnterDemo}
                        className="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] py-1 px-2.5 rounded text-[11px] flex items-center space-x-1 transition-colors"
                      >
                        <Copy size={11} />
                        <span>Tab 填入</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-[#8b949e] font-sans text-right pt-2 border-t border-[#30363d]">
                  按 <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded">Ctrl + \</kbd>{' '}
                  随时切回终端
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Problem & Solution Comparison */}
      <section id="comparison" className="py-20 px-6 max-w-6xl mx-auto border-t border-[#30363d]">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            为什么需要 MonoTerminal？
          </h2>
          <p className="text-sm sm:text-base text-[#8b949e]">
            重新审视开发者与运维人员每天面对的碎片化工具流
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Traditional Pain Points */}
          <div className="bg-[#161b22]/50 border border-red-900/30 rounded-xl p-6 relative overflow-hidden">
            <div className="flex items-center space-x-2.5 text-red-400 font-semibold mb-5 text-base">
              <XCircle size={20} />
              <span>传统排查工作流的割裂体验</span>
            </div>
            <ul className="space-y-4 text-sm text-[#8b949e]">
              <li className="flex items-start space-x-3">
                <span className="text-red-400 font-bold shrink-0">1.</span>
                <span>
                  <strong>手动复制大段日志</strong>
                  ：终端出现报错，只能手动滚动、鼠标框选，频繁切换到网页端大模型提问。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-red-400 font-bold shrink-0">2.</span>
                <span>
                  <strong>命令复制易出错</strong>
                  ：复制大模型给出的建议命令切回终端，手动粘贴，容易漏改关键参数。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-red-400 font-bold shrink-0">3.</span>
                <span>
                  <strong>远程改配置繁琐</strong>：修改 nginx.conf 或配置文件，要么忍受 vim/nano
                  的别扭快捷键，要么得另开繁重的 SFTP 客户端。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-red-400 font-bold shrink-0">4.</span>
                <span>
                  <strong>强制登录与隐私顾虑</strong>
                  ：许多工具要求微信扫码、手机号注册，甚至把服务器账密和日志上传到云端同步。
                </span>
              </li>
            </ul>
          </div>

          {/* Right: MonoTerminal Way */}
          <div className="bg-[#161b22] border border-emerald-500/30 rounded-xl p-6 relative overflow-hidden shadow-lg shadow-emerald-950/20">
            <div className="flex items-center space-x-2.5 text-emerald-400 font-semibold mb-5 text-base">
              <CheckCircle2 size={20} />
              <span>MonoTerminal 一体化体验</span>
            </div>
            <ul className="space-y-4 text-sm text-[#c9d1d9]">
              <li className="flex items-start space-x-3">
                <span className="text-emerald-400 font-bold shrink-0">1.</span>
                <span>
                  <strong>报错自动感知 + 一键穿梭</strong>：持续监听终端输出流，按{' '}
                  <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">
                    Ctrl + \
                  </kbd>{' '}
                  瞬间带入最近 50 行报错直接开始诊断。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-emerald-400 font-bold shrink-0">2.</span>
                <span>
                  <strong>回车直接运行命令</strong>：AI
                  给出的排错指令化作可交互卡片，按回车直接在终端中落地执行并切回终端。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-emerald-400 font-bold shrink-0">3.</span>
                <span>
                  <strong>集成 SFTP 与在线编辑器</strong>
                  ：左侧树形浏览远程文件，点击文件直接在线修改，按{' '}
                  <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">
                    Ctrl + S
                  </kbd>{' '}
                  实时写回远程。
                </span>
              </li>
              <li className="flex items-start space-x-3">
                <span className="text-emerald-400 font-bold shrink-0">4.</span>
                <span>
                  <strong>100% 零登录与本地加密</strong>：无账号体系，密码与 API Key 本地
                  AES-256-GCM 硬件派生加密，支持 Ollama 离线模型。
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. Core Features Grid */}
      <section id="features" className="py-20 px-6 max-w-6xl mx-auto border-t border-[#30363d]">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">核心特性</h2>
          <p className="text-sm sm:text-base text-[#8b949e]">精简、克制、专注于运维排障人机工学</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff]/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Lock size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              零登录，本地优先 (Local-First)
            </h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              无登录注册，无手机号绑定。所有服务器资产凭证与 API Key 均在本地通过机器特征派生密钥的{' '}
              <strong>AES-256-GCM</strong> 硬件级本地加密。
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-purple-500/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Bot size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">Shell ↔ Agent 穿梭流</h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              双图层 DOM 缓存架构，按{' '}
              <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">Ctrl + \</kbd>{' '}
              毫秒级瞬切终端与 AI 助手，后台 SSH 会话长连接保活不中断。
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-emerald-500/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FolderTree size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">SFTP 文件树与在线编辑</h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              左栏远程文件树支持自由拖拽调节宽度、按{' '}
              <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">Ctrl + B</kbd>{' '}
              极速收起；内置代码编辑器，按{' '}
              <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">Ctrl + S</kbd>{' '}
              实时写回。
            </p>
          </div>

          {/* Card 4 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-amber-500/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Cpu size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              Ollama 离线与自由接入 (BYOK)
            </h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              原生支持 <strong>Ollama 本地大模型直连</strong>，全内网离线秒通；同时支持 DeepSeek
              官方 API、OpenAI、Claude、通义千问等自带 Key 接入。
            </p>
          </div>

          {/* Card 5 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-red-500/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <ShieldCheck size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              危险命令安全门禁 (Guardrail)
            </h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              内置安全拦截层，精准拦截 <code>rm -rf /</code>、<code>mkfs</code>、<code>dd</code>{' '}
              等破坏性操作，必须强制手动确认或按{' '}
              <kbd className="text-white bg-[#21262d] px-1 py-0.5 rounded text-xs">Alt + Y</kbd>{' '}
              放行。
            </p>
          </div>

          {/* Card 6 */}
          <div className="bg-[#161b22] border border-[#30363d] hover:border-teal-500/50 rounded-xl p-6 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Zap size={20} />
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              开箱即用本机终端 (Local Shell) 与沙盒
            </h3>
            <p className="text-sm text-[#8b949e] leading-relaxed">
              启动即用基于 node-pty 的原生本机终端与本地文件浏览，支持系统 PowerShell/CMD/Bash/Zsh
              与 ANSI 全彩；同时内置 Linux 仿真运维沙盒，无需外部服务器即可直接上手。
            </p>
          </div>
        </div>
      </section>

      {/* 6. Shortcuts Cheat Sheet */}
      <section id="shortcuts" className="py-20 px-6 max-w-6xl mx-auto border-t border-[#30363d]">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">⌨️ 核心按键响应表</h2>
          <p className="text-sm sm:text-base text-[#8b949e]">告别低效点击，键盘流极速操作</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-[#58a6ff] mb-1">Ctrl + \</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              瞬切 Shell / Agent
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              自动提取终端最近 50 行输出作为排查背景
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-emerald-400 mb-1">Enter</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              一键执行建议命令
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              选中命令卡片敲回车，命令即刻在终端执行
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-yellow-400 mb-1">Tab</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">填入终端并切回</div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              将建议命令追加到当前提示符后等待修改
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-purple-400 mb-1">Ctrl + B</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              折叠 / 展开侧边栏
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              收起左侧 SFTP 树，主视窗空间扩展至 98%+
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-[#c9d1d9] mb-1">Ctrl + S</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              在线保存远程文件
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              在 SFTP 在线代码编辑器中即时写回服务器
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-[#c9d1d9] mb-1">Ctrl + T</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">新建会话标签</div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              顶部新增连接标签页，呼出主机列表
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-[#c9d1d9] mb-1">Ctrl + W</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">关闭当前会话</div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              安全关闭当前 Tab 并断开后台连接
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-amber-400 mb-1">Alt + P</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              Sudo 密码输入浮层
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              手动唤起敏感凭据浮层，安全隔离提权输入
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-lg">
            <div className="text-sm font-bold text-red-400 mb-1">Alt + Y</div>
            <div className="text-xs text-[#c9d1d9] font-sans font-medium mb-1">
              高危命令强制确认
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              在拦截弹窗中直接放行高危命令执行
            </div>
          </div>
        </div>
      </section>

      {/* 7. Quick Start & Packaging */}
      <section id="quickstart" className="py-20 px-6 max-w-6xl mx-auto border-t border-[#30363d]">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">🚀 快速上手与部署</h2>
          <p className="text-sm sm:text-base text-[#8b949e]">全栈开源，30 秒即可在本地快速启动</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-xs">
          {/* Method A */}
          <div className="bg-[#161b22] border border-[#30363d] p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-[#c9d1d9] font-sans font-semibold pb-2 border-b border-[#30363d]">
              <span>方式 1：生产全栈运行 (开箱体验)</span>
              <span className="text-[11px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">
                推荐
              </span>
            </div>
            <div className="text-[#8b949e] font-sans text-xs">
              拉取仓库并构建，由后端自动统一托管静态前端与 WebSocket 服务：
            </div>
            <div className="bg-[#0d1117] p-3 rounded-lg text-[#58a6ff] space-y-1 overflow-x-auto">
              <div>
                <span className="text-[#8b949e]"># 克隆并安装依赖</span>
              </div>
              <div>git clone https://github.com/sheilacraig/MonoTerminal.git</div>
              <div>cd MonoTerminal</div>
              <div>npm install</div>
              <div className="pt-2">
                <span className="text-[#8b949e]"># 构建前端与后端并启动服务</span>
              </div>
              <div>npm run serve</div>
              <div className="text-[11px] text-[#8b949e] pt-1">
                # 或分步：npm run build:all && npm start
              </div>
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              启动后在浏览器访问{' '}
              <code className="text-white bg-[#0d1117] px-1 py-0.5 rounded">
                http://localhost:3001
              </code>{' '}
              即可使用。
            </div>
          </div>

          {/* Method B */}
          <div className="bg-[#161b22] border border-[#30363d] p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-[#c9d1d9] font-sans font-semibold pb-2 border-b border-[#30363d]">
              <span>方式 2：桌面客户端模式 (Electron)</span>
              <span className="text-[11px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded">
                桌面端
              </span>
            </div>
            <div className="text-[#8b949e] font-sans text-xs">
              通过 Electron 外壳运行为原生桌面应用窗口，或打包为单文件 Windows <code>.exe</code>：
            </div>
            <div className="bg-[#0d1117] p-3 rounded-lg text-[#58a6ff] space-y-1 overflow-x-auto">
              <div>
                <span className="text-[#8b949e]"># 安装 Electron 依赖</span>
              </div>
              <div>npm install --save-dev electron</div>
              <div className="pt-2">
                <span className="text-[#8b949e]"># 启动桌面端原生外壳</span>
              </div>
              <div>npm run electron</div>
            </div>
            <div className="text-[11px] text-[#8b949e] font-sans">
              完整单文件 .exe 打包及 Windows 安装包指南：请参阅{' '}
              <a
                href="https://github.com/sheilacraig/MonoTerminal/blob/main/docs/PACKAGING.md"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline"
              >
                PACKAGING.md
              </a>
              。
            </div>
          </div>
        </div>
      </section>

      {/* 8. Bottom CTA Banner */}
      <section className="py-16 px-6 max-w-4xl mx-auto text-center border-t border-[#30363d]">
        <div className="bg-gradient-to-b from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-2xl p-10 relative overflow-hidden shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={24} />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            准备好升级你的终端排障体验了吗？
          </h2>
          <p className="text-sm text-[#8b949e] max-w-lg mx-auto mb-8">
            无需安装任何云服务或数据库，100% 本地优先与加密。直接下载 Windows
            桌面客户端，或克隆到本地快速启动。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://github.com/sheilacraig/MonoTerminal/releases"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto flex items-center justify-center space-x-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 px-6 py-2.5 rounded-lg shadow-lg shadow-blue-600/30 transition-all hover:scale-105 active:scale-95"
            >
              <Download size={15} />
              <span>下载桌面客户端 (Releases)</span>
            </a>

            <a
              href="https://github.com/sheilacraig/MonoTerminal"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto flex items-center justify-center space-x-2 text-sm font-medium text-[#c9d1d9] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] px-5 py-2.5 rounded-lg transition-colors"
            >
              <GithubIcon size={15} />
              <span>Star on GitHub</span>
            </a>
          </div>
        </div>
      </section>

      {/* 9. Footer */}
      <footer className="border-t border-[#30363d] py-8 px-6 text-center text-xs text-[#8b949e]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2 font-mono">
            <Terminal size={14} className="text-blue-400" />
            <span className="text-[#c9d1d9] font-medium">MonoTerminal</span>
            <span>- 零登录、本地优先的 AI 原生终端与 SFTP 客户端</span>
          </div>

          <div className="flex items-center space-x-4">
            <a
              href="https://github.com/sheilacraig/MonoTerminal"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub 仓库
            </a>
            <a
              href="https://github.com/sheilacraig/MonoTerminal/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              MIT License
            </a>
            <a
              href="https://github.com/sheilacraig/MonoTerminal/releases"
              target="_blank"
              rel="noreferrer"
              className="text-[#58a6ff] hover:underline font-medium"
            >
              Releases 下载
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
