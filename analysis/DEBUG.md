# Node.js 调试完整指南

## 概述
本指南提供了 Node.js 从启动到事件循环运行的完整调试方法，涵盖 JavaScript 层面、C++ 源码层面以及混合调试，支持 macOS、Linux 和 Windows 平台。

## 系统要求

### macOS
- macOS 10.14+ 
- Xcode Command Line Tools
- VS Code with C/C++ extension
- lldb 调试器

### Linux
- Ubuntu 18.04+ / CentOS 7+
- build-essential
- gdb 调试器

### Windows
- Visual Studio 2019+
- Windows SDK
- VS Code with C/C++ extension

## 调试环境准备

### 1. 安装调试依赖

#### macOS
```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Homebrew (如果还没有)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装编译依赖
brew install python3 ccache ninja
```

#### Linux
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install build-essential python3 ccache ninja-build gdb

# CentOS/RHEL
sudo yum install gcc-c++ python3 ccache ninja-build gdb
```

#### JavaScript 依赖
```bash
# 安装源码映射支持
npm install source-map-support

# 安装调试工具 (可选)
npm install --save-dev @types/node
```

### 2. 编译 Node.js

#### 调试版本编译
```bash
# 配置调试版本
./configure --debug --ninja

# 编译 (macOS)
make JOBS=$(sysctl -n hw.ncpu)

# 编译 (Linux)
make JOBS=$(nproc)

# 验证编译结果
ls -la out/Debug/node
./out/Debug/node --version
```

#### Release 版本编译
```bash
# 配置 Release 版本
./configure --ninja

# 编译
make JOBS=$(sysctl -n hw.ncpu)  # macOS
make JOBS=$(nproc)              # Linux
```

### 3. 调试器配置

#### macOS - lldb 配置
创建 `~/.lldbinit` 文件：
```bash
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

#### Linux - gdb 配置
创建 `~/.gdbinit` 文件：
```bash
cat > ~/.gdbinit << 'EOF'
set print pretty on
set print array on
set print array-indexes on
set history save on
set confirm off
EOF
```

## Node.js 启动和事件循环调试

### 主要调试断点链路

#### 1. Node.js 启动链路
```
main() 
  → node::Start() 
  → StartInternal() 
  → NodeMainInstance::Run()
  → SpinEventLoopInternal()
```

**关键断点位置**:
- `src/node_main.cc:96` - `main(int argc, char* argv[])` - 程序入口点
- `src/node.cc:1548` - `int Start(int argc, char** argv)` - 启动处理
- `src/node.cc:1485` - `static ExitCode StartInternal(int argc, char** argv)` - 内部启动逻辑
- `src/node_main_instance.cc:88` - `ExitCode NodeMainInstance::Run()` - 主实例运行

#### 2. 事件循环核心链路
```
SpinEventLoopInternal()
  ├── uv_run(env->event_loop(), UV_RUN_DEFAULT)     // libuv 事件循环
  ├── platform->DrainTasks(isolate)                // 平台任务处理
  │   └── FlushForegroundTasksInternal()           // 前台任务刷新
  ├── uv_loop_alive(env->event_loop())             // 检查循环存活
  └── EmitProcessBeforeExit(env)                   // beforeExit 事件
```

## 调试方法

### 1. JavaScript 层面调试

#### VS Code 调试配置
使用 `.vscode/launch.json` 中的配置：

- **"调试 Node.js 事件循环"**: 标准 JavaScript 调试
- **"调试 Node.js 源码"**: 包含源码映射的深度调试
- **"附加到运行中的 Node.js 进程"**: 附加调试

#### 设置断点位置
在 `debug-event-loop.js` 中标记了 23 个关键断点：

```javascript
// 断点 1-3: NextTick 优先级验证
process.nextTick(() => {
  console.log('4. process.nextTick 回调执行'); // 断点 1
});

// 断点 4-6: 定时器执行顺序
setTimeout(() => {
  console.log('Timer 0ms 执行'); // 断点 4
}, 0);

// 断点 7-13: 微任务和宏任务混合
// ... 更多断点
```

#### 调试步骤
1. 在 VS Code 中打开 `debug-event-loop.js`
2. 在标记的断点处设置断点
3. 选择调试配置 "调试 Node.js 事件循环"
4. 按 F5 启动调试
5. 观察执行顺序和调用栈

### 2. C++ 源码层面调试

#### 断点 1: SpinEventLoopInternal (主事件循环)
**位置**: `src/api/embed_helpers.cc:22`
```cpp
Maybe<ExitCode> SpinEventLoopInternal(Environment* env) {
  do {
    // 1. 运行 libuv 事件循环
    uv_run(env->event_loop(), UV_RUN_DEFAULT);  // 断点 A
    
    // 2. 排空平台任务队列 (Promise 微任务等)
    platform->DrainTasks(isolate);             // 断点 B
    
    // 3. 检查是否还有活跃的事件
    more = uv_loop_alive(env->event_loop());   // 断点 C
    
    // 4. 发出 beforeExit 事件
    if (EmitProcessBeforeExit(env).IsNothing()) break;
    
  } while (more == true && !env->is_stopping());
}
```

#### 断点 2: DrainTasks (平台任务排空)
**位置**: `src/node_platform.cc:578`
```cpp
void NodePlatform::DrainTasks(Isolate* isolate) {
  do {
    // 1. 阻塞等待 worker 线程任务完成
    worker_thread_task_runner_->BlockingDrain();  // 断点 D
    
    // 2. 刷新前台任务队列 (Promise 微任务)
  } while (per_isolate->FlushForegroundTasksInternal()); // 断点 E
}
```

#### 断点 3: FlushForegroundTasksInternal (前台任务刷新)
**位置**: `src/node_platform.cc:606`
```cpp
bool PerIsolatePlatformData::FlushForegroundTasksInternal() {
  // 1. 处理延迟任务队列 (setTimeout/setInterval)
  auto delayed_tasks = foreground_delayed_tasks_.Lock().PopAll(); // 断点 F
  
  // 2. 处理立即任务队列 (Promise 微任务)
  auto tasks = foreground_tasks_.Lock().PopAll(); // 断点 G
  
  while (!tasks.empty()) {
    RunForegroundTask(std::move(entry->task));
  }
  
  return did_work;
}
```

#### 使用 lldb 调试 (macOS)
```bash
# 编译带调试信息的 Node.js
./configure --debug --ninja
make JOBS=$(sysctl -n hw.ncpu)

# 启动 lldb 调试
lldb ./out/Debug/node
(lldb) target create "./out/Debug/node"
(lldb) settings set -- target.run-args "analysis/debug-event-loop.js"

# 设置关键断点
(lldb) breakpoint set --name SpinEventLoopInternal
(lldb) breakpoint set --name node::NodePlatform::DrainTasks  
(lldb) breakpoint set --name node::PerIsolatePlatformData::FlushForegroundTasksInternal

# 开始调试
(lldb) run

# 调试命令
(lldb) thread backtrace        # 查看调用栈
(lldb) frame variable          # 查看局部变量
(lldb) continue               # 继续执行
(lldb) step                   # 单步执行
```

#### 使用 gdb 调试 (Linux)
```bash
# 启动 gdb 调试
gdb ./out/Debug/node
(gdb) set args analysis/debug-event-loop.js

# 设置断点
(gdb) break SpinEventLoopInternal
(gdb) break NodePlatform::DrainTasks
(gdb) break PerIsolatePlatformData::FlushForegroundTasksInternal

# 开始调试
(gdb) run

# 调试命令
(gdb) backtrace               # 查看调用栈
(gdb) info locals             # 查看局部变量
(gdb) continue               # 继续执行
(gdb) step                   # 单步执行
```

#### VS Code C++ 调试
使用 `.vscode/launch.json` 中的配置：
- **"调试 libuv 事件循环 (Native - macOS)"**: macOS C++ 源码调试
- **"调试 libuv 事件循环 (Native - Linux/Windows)"**: Linux/Windows C++ 源码调试

### 3. 混合调试 (JavaScript + C++)

混合调试允许同时在 JavaScript 和 C++ 代码中设置断点，追踪从 JavaScript 调用到 C++ 实现的完整执行流程。

#### VS Code 混合调试配置

我们的 `launch.json` 已配置了专门的混合调试选项：

**方法一：使用复合配置（推荐）**
```json
"compounds": [
  {
    "name": "混合调试 (JavaScript + C++ macOS)",
    "configurations": [
      "调试 libuv 事件循环 (Native - macOS)",
      "附加到 Node.js Inspector"
    ]
  }
]
```

**方法二：手动两步启动**
1. 启动 C++ 调试器
2. 附加 JavaScript 调试器

#### 详细混合调试步骤

##### 步骤 1: 启动混合调试会话

1. **在 VS Code 中打开项目**
   ```bash
   cd /Users/zenheart/code/github/node
   code .
   ```

2. **设置断点**
   - **JavaScript 断点**: 在 `analysis/debug-event-loop.js` 中设置
     ```javascript
     // 在这些位置设置断点
     process.nextTick(() => {
       console.log('4. process.nextTick 回调执行'); // 断点
     });
     
     setTimeout(() => {
       console.log('Timer 0ms 执行'); // 断点
     }, 0);
     
     Promise.resolve().then(() => {
       console.log('Promise 微任务执行'); // 断点
     });
     ```

   - **C++ 断点**: 在 `src/api/embed_helpers.cc` 中设置
     ```cpp
     // 在这些位置设置断点
     do {
       if (env->is_stopping()) break;
       uv_run(env->event_loop(), UV_RUN_DEFAULT);      // 断点
       if (env->is_stopping()) break;
       platform->DrainTasks(isolate);                 // 断点
       more = uv_loop_alive(env->event_loop());       // 断点
     } while (more == true && !env->is_stopping());
     ```

3. **启动混合调试**
   - 按 `F5` 或点击调试面板
   - 选择 **"混合调试 (JavaScript + C++ macOS)"**
   - 或选择 **"混合调试 (JavaScript + C++ Linux)"**

##### 步骤 2: 验证调试环境

**检查 C++ 调试器状态**
```lldb
# 在 lldb 调试控制台中
(lldb) breakpoint list
# 应该显示设置的 C++ 断点

(lldb) target modules list
# 验证符号加载
```

**检查 JavaScript 调试器状态**
- 在 VS Code 调试面板查看 "Variables" 和 "Call Stack"
- 确认 JavaScript 调试器已连接

##### 步骤 3: 混合调试执行流程

**典型的混合调试流程**：

1. **程序启动** - C++ 断点命中
   ```
   main() → node::Start() → SpinEventLoopInternal()
   ```

2. **事件循环开始** - C++ 断点
   ```cpp
   // 断点命中: uv_run(env->event_loop(), UV_RUN_DEFAULT)
   // 此时可以检查 C++ 状态
   (lldb) frame variable env
   (lldb) frame variable platform
   ```

3. **JavaScript 代码执行** - JavaScript 断点
   ```javascript
   // 断点命中: 同步代码执行
   console.log('1. 同步代码开始');
   // 可以检查 JavaScript 变量和作用域
   ```

4. **回到 C++ 处理微任务** - C++ 断点
   ```cpp
   // 断点命中: platform->DrainTasks(isolate)
   // 检查微任务队列状态
   (lldb) step
   ```

5. **JavaScript 微任务执行** - JavaScript 断点
   ```javascript
   // 断点命中: Promise 微任务
   Promise.resolve().then(() => {
     console.log('Promise 微任务执行'); // 这里
   });
   ```

##### 步骤 4: 高级混合调试技巧

**1. 跟踪执行流程**
```bash
# 在一个终端监控进程
ps aux | grep node

# 在另一个终端监控网络连接
netstat -an | grep 9229  # JavaScript Inspector
netstat -an | grep 9230  # C++ Inspector (如果启用)
```

**2. 同步断点执行**
- 当 C++ 断点命中时，可以单步执行到 JavaScript 调用
- 当 JavaScript 断点命中时，可以查看 C++ 调用栈

**3. 变量检查对比**
```lldb
# C++ 端检查环境状态
(lldb) frame variable more
(lldb) expression env->is_stopping()
(lldb) print platform
```

在 JavaScript 调试控制台：
```javascript
// JavaScript 端检查状态
process._getActiveHandles().length
process._getActiveRequests().length
process.memoryUsage()
```

#### 手动混合调试方法

如果复合配置不工作，可以手动启动：

##### 方法 1: Inspector + 原生调试器

**启动 Node.js 带 Inspector**
```bash
# 启动带调试信息的 Node.js
./out/Debug/node --inspect-brk=9229 analysis/debug-event-loop.js
```

**连接原生调试器**
```bash
# macOS
lldb -p $(pgrep node)
(lldb) breakpoint set --name SpinEventLoopInternal
(lldb) continue

# Linux  
gdb -p $(pgrep node)
(gdb) break SpinEventLoopInternal
(gdb) continue
```

**连接 JavaScript 调试器**
- VS Code: 使用 "附加到 Node.js Inspector" 配置
- Chrome: 访问 `chrome://inspect`

##### 方法 2: 两个独立的调试会话

**会话 1: 启动 C++ 调试**
```bash
# 使用 VS Code 启动 "调试 libuv 事件循环 (Native - macOS)"
# 这会启动带 --inspect-brk=9230 的 Node.js
```

**会话 2: 连接 JavaScript 调试**
```bash
# 在另一个 VS Code 窗口或调试会话中
# 使用 "附加到 Node.js Inspector" 配置连接到端口 9230
```

#### 混合调试最佳实践

**1. 断点设置策略**
- 先在关键的 C++ 函数设置断点
- 在对应的 JavaScript 回调中设置断点
- 使用条件断点避免过多停顿

**2. 调试顺序**
```
C++ 启动 → JavaScript 执行 → C++ 微任务处理 → JavaScript 回调
```

**3. 状态同步检查**
- 在 C++ 端检查 libuv 循环状态
- 在 JavaScript 端检查事件队列
- 比较两端的内存使用情况

**4. 日志同步**
```cpp
// C++ 端添加调试日志
fprintf(stderr, "[C++] SpinEventLoopInternal: more=%d\n", more);
```

```javascript
// JavaScript 端添加调试日志
console.log('[JS] 当前阶段:', process.hrtime.bigint());
```

#### 常见混合调试问题

**1. 调试器连接失败**
```bash
# 检查端口占用
lsof -i :9229
lsof -i :9230

# 清理僵尸进程
pkill -f "node.*debug-event-loop"
```

**2. 断点不同步**
- 确保两个调试器都已正确连接
- 检查符号加载状态
- 验证源码映射配置

**3. 性能影响**
- 混合调试会显著影响性能
- 使用选择性断点而非全局断点
- 考虑分阶段调试不同组件

#### Chrome DevTools 混合调试

**启动方式**
```bash
# 启动调试服务器
./out/Debug/node --inspect=9229 analysis/debug-event-loop.js

# 打开 Chrome，访问 chrome://inspect
# 点击 "inspect" 连接到 Node.js 进程
```

**同时使用原生调试器**
```bash
# 在另一个终端连接原生调试器
lldb -p $(pgrep node)  # macOS
gdb -p $(pgrep node)   # Linux
```

**优势**：
- Chrome DevTools 提供强大的 JavaScript 调试功能
- 可以查看性能分析、内存使用等
- 与原生调试器配合使用，实现真正的混合调试

## 调试验证步骤

### 1. 启动调试会话

1. 确保已编译调试版本:
   ```bash
   ./configure --debug --ninja
   make JOBS=$(sysctl -n hw.ncpu)  # macOS
   make JOBS=$(nproc)              # Linux
   ```

2. 在 VS Code 中打开 `analysis/debug-event-loop.js`

3. 按 `F5` 选择相应的调试配置

### 2. 验证启动流程

观察断点命中顺序应该是:
```
node::Start() 
  → StartInternal()
  → NodeMainInstance::Run()
  → SpinEventLoopInternal()  // 第一个断点
```

### 3. 验证事件循环流程

在 `SpinEventLoopInternal` 断点处:

1. **检查初始状态**:
   ```lldb
   # macOS
   (lldb) frame variable env
   (lldb) frame variable platform
   (lldb) frame variable isolate
   ```
   
   ```gdb
   # Linux
   (gdb) info locals
   (gdb) print env
   (gdb) print platform
   ```

2. **单步执行到 uv_run**:
   ```lldb
   (lldb) step
   # 观察 libuv 事件循环的执行
   ```

3. **观察 DrainTasks 调用**:
   - 继续执行到 `platform->DrainTasks(isolate)` 
   - 断点应该命中 `NodePlatform::DrainTasks`

4. **验证任务刷新**:
   - 在 `DrainTasks` 中继续执行
   - 断点应该命中 `FlushForegroundTasksInternal`

### 4. 验证任务调度

在 `FlushForegroundTasksInternal` 断点处:

1. **检查延迟任务队列**:
   ```lldb
   (lldb) frame variable delayed_tasks_to_schedule
   (lldb) expression delayed_tasks_to_schedule.size()
   ```

2. **检查立即任务队列**:
   ```lldb
   (lldb) frame variable tasks
   (lldb) expression tasks.size()
   ```

3. **观察任务执行**:
   ```lldb
   (lldb) step
   # 观察 RunForegroundTask 的调用
   ```

## 执行顺序验证

### 预期输出顺序
运行调试脚本，观察输出顺序：
```
1. 同步代码开始
2. 同步代码继续  
3. 同步代码结束
4. process.nextTick 回调执行    ← 最高优先级
5. Promise 微任务执行          ← 微任务队列
6. setImmediate 回调执行       ← Check 阶段
```

### 任务调度优先级
1. **微任务** (在 `FlushForegroundTasksInternal` 中的立即任务队列)
2. **I/O 回调** (由 `uv_run` 处理)
3. **定时器回调** (延迟任务队列转换为 libuv timer)
4. **setImmediate 回调** (check 阶段)

## 性能监控和分析

### 1. 性能监控
```javascript
// 监控事件循环延迟
const startTime = process.hrtime.bigint();
setImmediate(() => {
  const delay = process.hrtime.bigint() - startTime;
  console.log(`事件循环延迟: ${Number(delay) / 1000000}ms`);
});
```

### 2. 内存使用跟踪
```javascript
const memBefore = process.memoryUsage();
// 执行异步操作
setTimeout(() => {
  const memAfter = process.memoryUsage();
  console.log('内存变化:', {
    rss: memAfter.rss - memBefore.rss,
    heapUsed: memAfter.heapUsed - memBefore.heapUsed
  });
}, 0);
```

### 3. 使用性能分析工具

#### macOS - Instruments
```bash
# 启动 Instruments 进行性能分析
instruments -t "Time Profiler" out/Debug/node analysis/debug-event-loop.js
```

#### Linux - perf
```bash
# 安装 perf 工具
sudo apt-get install linux-tools-generic  # Ubuntu
sudo yum install perf                      # CentOS

# 性能分析
perf record ./out/Debug/node analysis/debug-event-loop.js
perf report
```

## 常见调试技巧

### 1. 跟踪调用栈
```javascript
// 在关键点打印调用栈
function printStack(label) {
  console.log(`\n=== ${label} 调用栈 ===`);
  console.trace();
}
```

### 2. 监控事件循环状态
```javascript
// 监控 libuv 句柄数量
function monitorHandles() {
  const handles = process._getActiveHandles();
  const requests = process._getActiveRequests();
  console.log(`活跃句柄: ${handles.length}, 活跃请求: ${requests.length}`);
}
```

### 3. 异步堆栈跟踪
```bash
# 启用异步堆栈跟踪
node --async-stack-traces analysis/debug-event-loop.js
```

### 4. 符号表处理

#### macOS
```bash
# 生成调试符号
dsymutil out/Debug/node

# 查看符号信息
nm -D out/Debug/node | grep -i event
```

#### Linux
```bash
# 查看符号信息
objdump -t out/Debug/node | grep -i event
readelf -s out/Debug/node | grep -i event
```

## 故障排除

### 1. 编译错误
```bash
# 清理编译缓存
make distclean
./configure --debug --ninja
make JOBS=$(sysctl -n hw.ncpu)  # macOS
make JOBS=$(nproc)              # Linux
```

### 2. 符号信息缺失
```bash
# 确保编译时包含调试符号
./configure --debug --enable-static --ninja
make JOBS=$(sysctl -n hw.ncpu)  # macOS
make JOBS=$(nproc)              # Linux
```

### 3. 断点不触发
- 确保使用正确的函数名
- 检查 Node.js 版本兼容性
- 验证编译配置

#### 验证符号加载
```lldb
# macOS
(lldb) image lookup --name SpinEventLoopInternal
(lldb) target symbols add out/Debug/node.dSYM
```

```gdb
# Linux
(gdb) info functions SpinEventLoopInternal
(gdb) symbol-file out/Debug/node
```

### 4. 调试器连接问题
```bash
# 检查 inspector 端口
netstat -an | grep 9229

# 使用不同端口
node --inspect=9230 analysis/debug-event-loop.js
```

### 5. 权限问题

#### macOS
```bash
# 给调试器必要权限
sudo chmod +x out/Debug/node
codesign --force --deep --sign - out/Debug/node

# 系统完整性保护 (SIP) 检查
csrutil status
```

#### Linux
```bash
# 设置 ptrace 权限
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
```

### 6. 内存调试

#### 使用 Address Sanitizer
```bash
# macOS
export CC=clang CXX=clang++
./configure --debug --enable-asan --ninja
make JOBS=$(sysctl -n hw.ncpu)

# Linux
export CC=gcc CXX=g++
./configure --debug --enable-asan --ninja
make JOBS=$(nproc)
```

#### 使用 Valgrind (Linux)
```bash
# 安装 Valgrind
sudo apt-get install valgrind  # Ubuntu
sudo yum install valgrind      # CentOS

# 运行内存检查
valgrind --tool=memcheck --leak-check=full ./out/Debug/node analysis/debug-event-loop.js
```

## 验证调试环境

运行以下命令验证环境配置：

```bash
# 1. 验证 Node.js 编译
./out/Debug/node --version

# 2. 验证调试符号 (macOS)
lldb ./out/Debug/node -o "target symbols list" -o quit

# 2. 验证调试符号 (Linux)
gdb ./out/Debug/node -ex "info functions" -ex quit

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

## 总结

通过这套调试配置，可以完整验证:

1. **Node.js 启动流程**: 从 main() 到事件循环启动
2. **事件循环机制**: libuv 与 V8 任务调度的协调
3. **任务优先级**: 微任务、宏任务、I/O 的执行顺序
4. **性能特征**: 任务队列大小对循环性能的影响
5. **跨平台兼容**: 支持 macOS、Linux 和 Windows 的调试

这为深入理解 Node.js 内部机制和性能优化提供了强有力的工具，帮助开发者从多个层面分析和调试 Node.js 应用。
