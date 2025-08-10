# Node.js 事件循环调试指南

## 概述
本指南提供了多种调试 Node.js 事件循环的方法，包括 JavaScript 层面和 C++ 源码层面的调试。

## 调试环境准备

### 1. 安装调试依赖
```bash
# 安装源码映射支持
npm install source-map-support

# 安装调试工具 (可选)
npm install --save-dev @types/node
```

### 2. 编译 Node.js (用于 C++ 调试)
```bash
# 编译带调试信息的 Node.js
./configure --debug
make -j4

# 或者编译 Release 版本
./configure
make -j4
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

#### 使用 lldb 调试 (macOS)
```bash
# 编译带调试信息的 Node.js
./configure --debug
make -j4

# 启动 lldb 调试
lldb ./out/Debug/node
(lldb) target create "./out/Debug/node"
(lldb) settings set -- target.run-args  "analysis/debug-event-loop.js"

# 设置关键断点
(lldb) breakpoint set --name SpinEventLoopInternal
(lldb) breakpoint set --name NodePlatform::DrainTasks  
(lldb) breakpoint set --name PerIsolatePlatformData::FlushForegroundTasksInternal

# 开始调试
(lldb) run
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
```

#### VS Code C++ 调试
使用 `.vscode/launch.json` 中的配置：
- **"调试 libuv 事件循环 (Native)"**: C++ 源码调试

### 3. 混合调试 (JavaScript + C++)

#### 启用 Inspector 协议
```bash
# 启动带 inspector 的 Node.js
node --inspect-brk analysis/debug-event-loop.js

# 在另一个终端连接 lldb
lldb -p $(pgrep node)
```

#### Chrome DevTools 调试
```bash
# 启动调试服务器
node --inspect analysis/debug-event-loop.js

# 打开 Chrome，访问 chrome://inspect
# 点击 "inspect" 连接到 Node.js 进程
```

## 关键调试点

### 1. 事件循环主入口
**文件**: `src/api/embed_helpers.cc`
**函数**: `SpinEventLoopInternal`
```cpp
// 设置断点验证主循环逻辑
Maybe<ExitCode> SpinEventLoopInternal(Environment* env) {
  do {
    uv_run(env->event_loop(), UV_RUN_DEFAULT);  // 断点 A
    platform->DrainTasks(isolate);             // 断点 B
    more = uv_loop_alive(env->event_loop());   // 断点 C
  } while (more == true && !env->is_stopping());
}
```

### 2. 平台任务处理
**文件**: `src/node_platform.cc`
**函数**: `DrainTasks`
```cpp
void NodePlatform::DrainTasks(Isolate* isolate) {
  do {
    worker_thread_task_runner_->BlockingDrain();  // 断点 D
  } while (per_isolate->FlushForegroundTasksInternal()); // 断点 E
}
```

### 3. 前台任务队列
**文件**: `src/node_platform.cc`
**函数**: `FlushForegroundTasksInternal`
```cpp
bool PerIsolatePlatformData::FlushForegroundTasksInternal() {
  // 处理延迟任务 (setTimeout/setInterval)
  auto delayed_tasks = foreground_delayed_tasks_.Lock().PopAll(); // 断点 F
  
  // 处理立即任务 (Promise 微任务)
  auto tasks = foreground_tasks_.Lock().PopAll(); // 断点 G
}
```

## 验证流程

### 1. 执行顺序验证
运行调试脚本，观察输出顺序：
```
1. 同步代码开始
2. 同步代码继续  
3. 同步代码结束
4. process.nextTick 回调执行    ← 最高优先级
5. Promise 微任务执行          ← 微任务队列
6. setImmediate 回调执行       ← Check 阶段
```

### 2. 性能监控
```javascript
// 监控事件循环延迟
const startTime = process.hrtime.bigint();
setImmediate(() => {
  const delay = process.hrtime.bigint() - startTime;
  console.log(`事件循环延迟: ${Number(delay) / 1000000}ms`);
});
```

### 3. 内存使用跟踪
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

## 故障排除

### 1. 符号信息缺失
```bash
# 确保编译时包含调试符号
./configure --debug --enable-static
make -j4
```

### 2. 断点不触发
- 确保使用正确的函数名
- 检查 Node.js 版本兼容性
- 验证编译配置

### 3. 调试器连接问题
```bash
# 检查 inspector 端口
netstat -an | grep 9229

# 使用不同端口
node --inspect=9230 analysis/debug-event-loop.js
```

通过这些调试方法，你可以深入理解 Node.js 事件循环的执行流程，验证理论分析的正确性。
