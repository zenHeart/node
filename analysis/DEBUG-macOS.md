# macOS 下的 Node.js 事件循环调试指南

## 系统要求

- macOS 10.14+ 
- Xcode Command Line Tools
- VS Code with C/C++ extension
- Node.js 源码编译环境

## 安装调试环境

### 1. 安装必要工具
```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Homebrew (如果还没有)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装编译依赖
brew install python3 ccache ninja
```

### 2. 编译带调试信息的 Node.js
```bash
# 进入 Node.js 源码目录
cd /Users/gufeng/self/node

# 配置调试版本
./configure --debug --ninja

# 编译 (使用 ccache 加速)
make -j$(sysctl -n hw.ncpu)

# 验证编译结果
ls -la out/Debug/node
```

## macOS 特定的调试配置

### 1. lldb 调试器设置

创建 `~/.lldbinit` 文件：
```bash
# 创建 lldb 配置文件
cat > ~/.lldbinit << 'EOF'
# 设置源码路径
settings set target.source-map /usr/include /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/include

# 启用彩色输出
settings set use-color true

# 设置历史记录
settings set interpreter.save-session-on-quit true

# 自定义断点别名
command alias bnode breakpoint set --name
command alias bfile breakpoint set --file
EOF
```

### 2. VS Code 调试配置

已经为 macOS 优化了以下配置：

- **"调试 libuv 事件循环 (Native - macOS)"**: 使用 lldb 调试器
- **"调试 libuv 事件循环 (Native - Linux/Windows)"**: 使用 gdb 调试器

### 3. 系统完整性保护 (SIP) 设置

如果遇到权限问题，可能需要调整 SIP 设置：

```bash
# 检查 SIP 状态
csrutil status

# 如果需要，重启到恢复模式禁用 SIP
# 注意：这会降低系统安全性，仅在必要时使用
```

## macOS 调试工作流

### 1. 快速 JavaScript 调试
```bash
# 启动调试服务器
node --inspect-brk analysis/debug-event-loop.js

# 在 Chrome 中打开
open "chrome://inspect"
```

### 2. lldb 命令行调试
```bash
# 启动 lldb
lldb out/Debug/node

# 设置参数
(lldb) settings set -- target.run-args "analysis/debug-event-loop.js"

# 设置关键断点
(lldb) breakpoint set --name SpinEventLoopInternal
(lldb) breakpoint set --name node::NodePlatform::DrainTasks
(lldb) breakpoint set --name node::PerIsolatePlatformData::FlushForegroundTasksInternal

# 运行程序
(lldb) run

# 调试命令
(lldb) thread backtrace        # 查看调用栈
(lldb) frame variable          # 查看局部变量
(lldb) continue               # 继续执行
(lldb) step                   # 单步执行
```

### 3. VS Code 集成调试

1. 打开 `analysis/debug-event-loop.js`
2. 在关键位置设置断点
3. 按 `F5` 选择调试配置：
   - **JavaScript 调试**: 选择 "调试 Node.js 事件循环"
   - **C++ 调试**: 选择 "调试 libuv 事件循环 (Native - macOS)"

### 4. 性能分析工具

#### 使用 Instruments
```bash
# 启动 Instruments 进行性能分析
instruments -t "Time Profiler" out/Debug/node analysis/debug-event-loop.js
```

#### 使用 dtrace (如果可用)
```bash
# 监控系统调用
sudo dtruss -fn node out/Debug/node analysis/debug-event-loop.js
```

## macOS 特定的调试技巧

### 1. 符号表处理
```bash
# 生成调试符号
dsymutil out/Debug/node

# 查看符号信息
nm -D out/Debug/node | grep -i event
```

### 2. 内存调试
```bash
# 使用 Address Sanitizer
export CC=clang CXX=clang++
./configure --debug --enable-asan
make -j$(sysctl -n hw.ncpu)
```

### 3. 线程调试
```lldb
# 在 lldb 中查看所有线程
(lldb) thread list

# 切换到特定线程
(lldb) thread select 2

# 查看线程调用栈
(lldb) thread backtrace all
```

## 常见问题解决

### 1. 编译错误
```bash
# 清理编译缓存
make distclean
./configure --debug --ninja
make -j$(sysctl -n hw.ncpu)
```

### 2. 调试器连接失败
```bash
# 检查端口占用
lsof -i :9229

# 使用不同端口
node --inspect=9230 analysis/debug-event-loop.js
```

### 3. 权限问题
```bash
# 给调试器必要权限
sudo chmod +x out/Debug/node
codesign --force --deep --sign - out/Debug/node
```

### 4. 符号加载问题
```lldb
# 手动加载符号
(lldb) target symbols add out/Debug/node.dSYM
```

## 验证调试环境

运行以下命令验证环境配置：

```bash
# 1. 验证 Node.js 编译
./out/Debug/node --version

# 2. 验证调试符号
lldb ./out/Debug/node -o "target symbols list" -o quit

# 3. 运行调试测试
node analysis/debug-event-loop.js

# 4. 测试 VS Code 调试
code . # 打开 VS Code，按 F5 测试调试配置
```

## 性能优化建议

### 1. 编译优化
```bash
# 使用 ccache 加速重新编译
export CC="ccache clang"
export CXX="ccache clang++"
./configure --debug --ninja
```

### 2. 调试优化
```bash
# 限制调试输出
export NODE_DEBUG=

# 使用更快的调试版本
./configure --debug-node --ninja
```

这个配置现在完全针对 macOS 进行了优化，支持原生 lldb 调试器和 macOS 特有的调试工具。
