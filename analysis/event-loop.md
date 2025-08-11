# Node.js 事件循环完整分析

## 概述

Node.js 事件循环是一个多层次、多队列的复杂系统，协调处理各种异步操作。它使得 Node.js 能够执行非阻塞 I/O 操作——尽管 JavaScript 是单线程的——通过将操作转移到系统内核来实现。

由于大多数现代内核都是多线程的，它们可以处理在后台执行的多个操作。当其中一个操作完成时，内核会通知 Node.js，以便将适当的回调添加到 **poll** 队列中最终执行。

## 事件循环初始化

当 Node.js 启动时，它会初始化事件循环，处理提供的输入脚本（或进入 REPL），这可能会进行异步 API 调用、调度定时器或调用 `process.nextTick()`，然后开始处理事件循环。

## 事件循环阶段图

以下图表显示了事件循环操作顺序的简化概述：

```text
   ┌───────────────────────────┐
┌─>│           timers          │  ← setTimeout, setInterval
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  ← 上一轮循环推迟的I/O回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │  ← 内部使用
│  └─────────────┬─────────────┘      ┌───────────────┐
│  ┌─────────────┴─────────────┐      │   incoming:   │
│  │           poll            │<─────┤  connections, │  ← 获取新的I/O事件
│  └─────────────┬─────────────┘      │   data, etc.  │
│  ┌─────────────┴─────────────┐      └───────────────┘
│  │           check           │  ← setImmediate 回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
└──┤      close callbacks      │  ← socket.on('close', ...)
   └───────────────────────────┘
```

> 每个方框被称为事件循环的一个"阶段"。

每个阶段都有一个要执行的回调 FIFO 队列。虽然每个阶段都有其特殊性，但通常，当事件循环进入给定阶段时，它将执行该阶段特有的任何操作，然后执行该阶段队列中的回调，直到队列耗尽或执行的回调数量达到最大值。当队列耗尽或达到回调限制时，事件循环将移动到下一个阶段，依此类推。

## 阶段详细说明

### timers 阶段

定时器指定**阈值**，*在此之后*可以执行提供的回调，而不是用户*希望*执行回调的**确切**时间。定时器回调将在指定的时间过去后尽可能早地运行；但是，操作系统调度或其他回调的运行可能会延迟它们。

> 技术上，**poll** 阶段控制何时执行定时器。

### pending callbacks 阶段

此阶段执行某些系统操作的回调，例如 TCP 错误类型。例如，如果 TCP socket 在尝试连接时接收到 `ECONNREFUSED`，某些 *nix 系统希望等待报告错误。这将被排队在 **pending callbacks** 阶段执行。

### poll 阶段

**poll** 阶段有两个主要功能：

1. 计算它应该阻塞并轮询 I/O 多长时间，然后
2. 处理 **poll** 队列中的事件。

当事件循环进入 **poll** 阶段且*没有调度定时器*时，将发生以下两种情况之一：

- *如果 **poll** 队列**不为空***，事件循环将同步遍历其回调队列执行它们，直到队列耗尽或达到系统相关的硬限制。

- *如果 **poll** 队列**为空***，将发生以下两种情况之一：
  - 如果脚本已被 `setImmediate()` 调度，事件循环将结束 **poll** 阶段并继续到 **check** 阶段以执行那些调度的脚本。
  - 如果脚本**没有**被 `setImmediate()` 调度，事件循环将等待回调被添加到队列中，然后立即执行它们。

一旦 **poll** 队列为空，事件循环将检查*已达到时间阈值*的定时器。如果一个或多个定时器准备就绪，事件循环将回到 **timers** 阶段以执行那些定时器的回调。

### check 阶段

此阶段允许事件循环在 **poll** 阶段完成后立即执行回调。如果 **poll** 阶段变为空闲且脚本已使用 `setImmediate()` 排队，事件循环可能会继续到 **check** 阶段而不是等待。

`setImmediate()` 实际上是一个在事件循环的单独阶段运行的特殊定时器。它使用 libuv API 来调度在 **poll** 阶段完成后执行的回调。

### close callbacks 阶段

如果 socket 或句柄突然关闭（例如 `socket.destroy()`），`'close'` 事件将在此阶段发出。否则它将通过 `process.nextTick()` 发出。

## `setImmediate()` vs `setTimeout()` 详细对比

`setImmediate()` 和 `setTimeout()` 相似，但根据调用时机表现不同。

- `setImmediate()` 设计为在当前 **poll** 阶段完成后执行脚本。
- `setTimeout()` 调度脚本在经过最小阈值（毫秒）后运行。

### 在主模块中的执行顺序

如果两者都从主模块内调用，那么定时器的执行顺序将受进程性能约束（可能受机器上运行的其他应用程序影响）：

```javascript
// timeout_vs_immediate.js
setTimeout(() => {
  console.log('timeout');
}, 0);

setImmediate(() => {
  console.log('immediate');
});
```

运行结果是不确定的：

```bash
$ node timeout_vs_immediate.js
timeout
immediate

$ node timeout_vs_immediate.js
immediate
timeout
```

### 在 I/O 回调中的执行顺序

但是，如果您将两个调用移到 I/O 回调内，immediate 回调始终首先执行：

```javascript
// timeout_vs_immediate.js
const fs = require('fs');

fs.readFile(__filename, () => {
  setTimeout(() => {
    console.log('timeout');
  }, 0);
  setImmediate(() => {
    console.log('immediate');
  });
});
```

运行结果是确定的：

```bash
$ node timeout_vs_immediate.js
immediate
timeout
```

使用 `setImmediate()` 相对于 `setTimeout()` 的主要优势是，如果在 I/O 周期内调度，`setImmediate()` 将始终在任何定时器之前执行，无论存在多少个定时器。

## `process.nextTick()` 详细分析

### 理解 `process.nextTick()`

您可能已经注意到 `process.nextTick()` 没有显示在图表中，即使它是异步 API 的一部分。这是因为 `process.nextTick()` 技术上不是事件循环的一部分。相反，`nextTickQueue` 将在当前操作完成后处理，无论事件循环的当前阶段如何。这里，*操作*被定义为从底层 C/C++ 处理程序的转换，以及处理需要执行的 JavaScript。

回顾我们的图表，任何时候您在给定阶段调用 `process.nextTick()`，传递给 `process.nextTick()` 的所有回调都将在事件循环继续之前解决。这可能会造成一些糟糕的情况，因为**它允许您通过进行递归 `process.nextTick()` 调用来"饿死"您的 I/O**，这会阻止事件循环到达 **poll** 阶段。

### 为什么允许这样做？

为什么 Node.js 中会包含这样的东西？部分原因是设计理念，即 API 应该始终是异步的，即使在不必要的地方也是如此。采用这个代码片段举例：

```javascript
function apiCall(arg, callback) {
  if (typeof arg !== 'string')
    return process.nextTick(
      callback,
      new TypeError('argument should be string')
    );
}
```

这个片段进行参数检查，如果不正确，它将把错误传递给回调。API 最近更新，允许将参数传递给 `process.nextTick()`，使其能够接受回调后传递的任何参数作为回调的参数传播，这样您就不必嵌套函数。

我们正在做的是将错误传递回用户，但只有在我们允许用户的其余代码执行*之后*。通过使用 `process.nextTick()`，我们保证 `apiCall()` 始终在用户的其余代码*之后*和事件循环被允许继续*之前*运行其回调。为了实现这一点，允许 JS 调用栈展开，然后立即执行提供的回调，这使得一个人可以对 `process.nextTick()` 进行递归调用，而不会从 v8 达到 `RangeError: Maximum call stack size exceeded`。

### API 一致性示例

这种理念可能导致一些潜在的问题情况。看这个片段：

```javascript
let bar = null;

// 这有一个异步签名，但同步调用回调
function someAsyncApiCall(callback) {
  callback();
}

// 回调在 `someAsyncApiCall` 完成之前被调用。
someAsyncApiCall(() => {
  // 由于 someAsyncApiCall 还没有完成，bar 还没有被分配任何值
  console.log('bar', bar); // null
});

bar = 1;
```

用户定义 `someAsyncApiCall()` 具有异步签名，但它实际上同步操作。当它被调用时，提供给 `someAsyncApiCall()` 的回调在事件循环的同一阶段被调用，因为 `someAsyncApiCall()` 实际上没有异步地做任何事情。结果，回调尝试引用 `bar`，即使它可能还没有在作用域中有该变量，因为脚本还没有能够运行完成。

通过将回调放在 `process.nextTick()` 中，脚本仍然具有运行完成的能力，允许在调用回调之前初始化所有变量、函数等。它还具有不允许事件循环继续的优势。在允许事件循环继续之前，用户被警告错误可能是有用的。这是使用 `process.nextTick()` 的前一个示例：

```javascript
let bar = null;

function someAsyncApiCall(callback) {
  process.nextTick(callback);
}

someAsyncApiCall(() => {
  console.log('bar', bar); // 1
});

bar = 1;
```

### EventEmitter 中的应用

这是另一个真实世界的例子：

```javascript
const server = net.createServer(() => {}).listen(8080);

server.on('listening', () => {});
```

当只传递端口时，端口立即绑定。因此，`'listening'` 回调可能立即被调用。问题是 `.on('listening')` 回调那时还没有设置。

为了解决这个问题，`'listening'` 事件在 `nextTick()` 中排队，以允许脚本运行完成。这允许用户设置他们想要的任何事件处理程序。

## `process.nextTick()` vs `setImmediate()`

就用户而言，我们有两个调用很相似，但它们的名称令人困惑。

- `process.nextTick()` 在同一阶段立即触发
- `setImmediate()` 在事件循环的下一次迭代或 'tick' 上触发

本质上，名称应该交换。`process.nextTick()` 比 `setImmediate()` 触发得更立即，但这是过去的产物，不太可能改变。进行此切换将破坏 npm 上的大量包。每天都有更多新模块被添加，这意味着我们等待的每一天，都会发生更多潜在的破坏。虽然它们令人困惑，但名称本身不会改变。

> 我们建议开发人员在所有情况下都使用 `setImmediate()`，因为它更容易推理。

### 为什么使用 `process.nextTick()`？

有两个主要原因：

1. 允许用户处理错误，清理任何不需要的资源，或者也许在事件循环继续之前重试请求。
2. 有时在调用栈展开但事件循环继续之前允许回调运行是必要的。

一个示例是匹配用户的期望。简单示例：

```javascript
const server = net.createServer();
server.on('connection', conn => {});

server.listen(8080);
server.on('listening', () => {});
```

假设 `listen()` 在事件循环开始时运行，但监听回调放在 `setImmediate()` 中。除非传递主机名，否则绑定到端口将立即发生。为了事件循环继续，它必须到达 **poll** 阶段，这意味着有一个非零的机会，连接可能已经被接收，允许在监听事件之前触发连接事件。

### EventEmitter 构造函数示例

另一个示例是扩展 `EventEmitter` 并从构造函数内发出事件：

```javascript
const EventEmitter = require('events');

class MyEmitter extends EventEmitter {
  constructor() {
    super();
    this.emit('event');
  }
}

const myEmitter = new MyEmitter();
myEmitter.on('event', () => {
  console.log('an event occurred!');
});
```

您无法立即从构造函数发出事件，因为脚本尚未处理到用户将回调分配给该事件的地方。因此，在构造函数本身内，您可以使用 `process.nextTick()` 设置回调以在构造函数完成后发出事件，这提供了预期的结果：

```javascript
const EventEmitter = require('events');

class MyEmitter extends EventEmitter {
  constructor() {
    super();

    // 使用 nextTick 在分配处理程序后发出事件
    process.nextTick(() => {
      this.emit('event');
    });
  }
}

const myEmitter = new MyEmitter();
myEmitter.on('event', () => {
  console.log('an event occurred!');
});
```

## 定时器精度和长时间回调影响

定时器指定**阈值**，*在此之后*可以执行提供的回调，而不是用户*希望*执行回调的**确切**时间。定时器回调将在指定的时间过去后尽可能早地运行；但是，操作系统调度或其他回调的运行可能会延迟它们。

例如，假设您调度一个在 100 毫秒阈值后执行的超时，然后您的脚本开始异步读取需要 95 毫秒的文件：

```javascript
const fs = require('fs');

function someAsyncOperation(callback) {
  // 假设这需要 95ms 完成
  fs.readFile('/path/to/file', callback);
}

const timeoutScheduled = Date.now();

setTimeout(() => {
  const delay = Date.now() - timeoutScheduled;
  console.log(`${delay}ms have passed since I was scheduled`);
}, 100);

// 做一些需要 95ms 完成的异步操作
someAsyncOperation(() => {
  const startCallback = Date.now();

  // 做一些需要 10ms 的事情...
  while (Date.now() - startCallback < 10) {
    // 什么都不做
  }
});
```

当事件循环进入 **poll** 阶段时，它有一个空队列（`fs.readFile()` 尚未完成），因此它将等待剩余毫秒数，直到达到最近定时器的阈值。当它等待 95 毫秒通过时，`fs.readFile()` 完成读取文件，其需要 10 毫秒完成的回调被添加到 **poll** 队列并执行。当回调完成时，队列中没有更多回调，因此事件循环将看到最近定时器的阈值已达到，然后回到 **timers** 阶段以执行定时器的回调。在此示例中，您将看到调度定时器和执行其回调之间的总延迟将是 105 毫秒。

> 为了防止 **poll** 阶段饿死事件循环，libuv（实现 Node.js 事件循环和平台所有异步行为的 C 库）也有一个硬最大值（系统相关）在停止轮询更多事件之前。

## 主要组件

### 1. 主事件循环 - SpinEventLoopInternal

**位置**: [src/api/embed_helpers.cc](../src/api/embed_helpers.cc#L40)

```cpp
Maybe<ExitCode> SpinEventLoopInternal(Environment* env) {
  do {
    if (env->is_stopping()) break;
    
    // 1. 运行 libuv 事件循环
    uv_run(env->event_loop(), UV_RUN_DEFAULT);
    
    if (env->is_stopping()) break;
    
    // 2. 排空平台任务队列 (Promise 微任务等)
    platform->DrainTasks(isolate);
    
    // 3. 检查是否还有活跃的事件
    more = uv_loop_alive(env->event_loop());
    if (more && !env->is_stopping()) continue;
    
    // 4. 发出 beforeExit 事件
    if (EmitProcessBeforeExit(env).IsNothing())
      break;
      
  } while (more == true && !env->is_stopping());
  
  return env->exit_code();
}
```

### 2. 平台任务循环 - DrainTasks

**位置**: [src/node_platform.cc#L415](../src/node_platform.cc#L578)

```cpp
void NodePlatform::DrainTasks(Isolate* isolate) {
  std::shared_ptr<PerIsolatePlatformData> per_isolate = ForNodeIsolate(isolate);
  if (!per_isolate) return;

  do {
    // 1. 阻塞等待 worker 线程任务完成
    worker_thread_task_runner_->BlockingDrain();
    
    // 2. 刷新前台任务队列 (Promise 微任务)
  } while (per_isolate->FlushForegroundTasksInternal());
}
```

### 3. 前台任务处理循环 - FlushForegroundTasksInternal

**位置**: [src/node_platform.cc#L680](../src/node_platform.cc#L606)

```cpp
bool PerIsolatePlatformData::FlushForegroundTasksInternal() {
  bool did_work = false;

  // 1. 处理延迟任务队列 (setTimeout/setInterval)
  auto delayed_tasks_to_schedule = foreground_delayed_tasks_.Lock().PopAll();
  while (!delayed_tasks_to_schedule.empty()) {
    std::unique_ptr<DelayedTask> delayed =
        std::move(const_cast<std::unique_ptr<DelayedTask>&>(
            delayed_tasks_to_schedule.top()));
    delayed_tasks_to_schedule.pop();

    did_work = true;
    uint64_t delay_millis = llround(delayed->timeout * 1000);

    delayed->timer.data = static_cast<void*>(delayed.get());
    uv_timer_init(loop_, &delayed->timer);
    // 转换为 libuv timer
    uv_timer_start(&delayed->timer, RunForegroundTask, delay_millis, 0);
    uv_unref(reinterpret_cast<uv_handle_t*>(&delayed->timer));
  }

  // 2. 处理立即任务队列 (Promise 微任务)
  TaskQueue<TaskQueueEntry>::PriorityQueue tasks;
  {
    auto locked = foreground_tasks_.Lock();
    tasks = locked.PopAll();
  }

  while (!tasks.empty()) {
    std::unique_ptr<TaskQueueEntry> entry =
        std::move(const_cast<std::unique_ptr<TaskQueueEntry>&>(tasks.top()));
    tasks.pop();
    did_work = true;
    RunForegroundTask(std::move(entry->task));
  }

  return did_work;
}
```

## 任务队列系统

### 任务队列定义

**位置**: [src/node_platform.h#L180](../src/node_platform.h#L180)

```cpp
// 立即执行的前台任务队列 - Promise 微任务等
TaskQueue<TaskQueueEntry> foreground_tasks_;

// 延迟执行的前台任务队列 - setTimeout/setInterval 等  
TaskQueue<DelayedTask> foreground_delayed_tasks_;

// Worker 线程的任务队列 - 处理 CPU 密集型任务
TaskQueue<TaskQueueEntry> pending_worker_tasks_;
```

### 任务优先级系统

**位置**: [src/node_platform.cc#L125](../src/node_platform.cc#L125)

```cpp
const char* GetTaskPriorityName(TaskPriority priority) {
  switch (priority) {
    case TaskPriority::kUserBlocking:     // 最高优先级 (Promise 微任务)
      return "UserBlocking";
    case TaskPriority::kUserVisible:      // 中等优先级
      return "UserVisible";  
    case TaskPriority::kBestEffort:       // 最低优先级
      return "BestEffort";
  }
}
```

## 定时器处理

**位置**: [src/env.cc#L890](../src/env.cc#L890)

```cpp
void Environment::RunTimers(uv_timer_t* handle) {
  // 处理定时器回调的事件循环部分
  Local<Function> cb = env->timers_callback_function();
  do {
    ret = cb->Call(env->context(), process, 1, &arg);
  } while (/* 条件 */);
}
```

## Worker 线程任务循环

**位置**: [src/node_platform.cc#L320](../src/node_platform.cc#L320)

```cpp
static void PlatformWorkerThread(void* data) {
  // Worker 线程的主循环
  while (std::unique_ptr<TaskQueueEntry> entry =
             pending_worker_tasks->Lock().BlockingPop()) {
    
    // 执行 worker 任务
    entry->task->Run();
    
    // 处理任务完成通知
    if (entry->is_outstanding()) {
      pending_worker_tasks->Lock().NotifyOfOutstandingCompletion();
    }
  }
}
```

## 执行流程图

```text
┌─────────────────────────────────────────────────────────────┐
│                 Node.js 事件循环主流程                        │
│                 SpinEventLoopInternal                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   libuv 事件循环                             │
│                uv_run(UV_RUN_DEFAULT)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Timers    │ │    Poll     │ │   Check     │           │
│  │  阶段处理    │ │   阶段处理   │ │  阶段处理    │           │
│  │setTimeout   │ │  I/O 回调   │ │setImmediate │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               平台任务处理 DrainTasks                        │
│              处理 V8 引擎相关任务                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            Worker 任务处理 BlockingDrain                    │
│            处理后台线程任务                                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│         前台任务处理 FlushForegroundTasksInternal           │
│  ┌─────────────────┐     ┌─────────────────────────────────┐ │
│  │   延迟任务队列    │     │        立即任务队列              │ │
│  │ setTimeout/     │────▶│      Promise 微任务             │ │
│  │ setInterval     │     │      queueMicrotask            │ │
│  │ 转换为 uv_timer │     │      立即执行                   │ │
│  └─────────────────┘     └─────────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  检查循环继续条件                            │
│              uv_loop_alive() 检查                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                EmitProcessBeforeExit                        │
│                  发出 beforeExit 事件                       │
└─────────────────────────────────────────────────────────────┘
```

## JavaScript 任务优先级执行顺序

```text
每个事件循环 Tick:
├── 1. process.nextTick 队列 (最高优先级)
├── 2. libuv 各阶段处理
│   ├── Timer 阶段: setTimeout/setInterval 回调
│   ├── Poll 阶段: I/O 回调  
│   └── Check 阶段: setImmediate 回调
├── 3. Promise 微任务队列 (foreground_tasks_)
│   ├── Promise.then/catch/finally
│   └── queueMicrotask
└── 4. Worker 任务队列 (pending_worker_tasks_)
```

## 队列协调机制

事件循环通过多个独立的任务队列来管理不同类型的异步操作：

1. **任务优先级**: 高优先级任务优先执行 (kUserBlocking > kUserVisible > kBestEffort)
2. **并发安全**: 多线程环境下的任务调度通过锁机制保证
3. **性能优化**: 避免阻塞主线程，通过 Worker 线程处理 CPU 密集型任务
4. **规范遵循**: 符合 JavaScript 事件循环规范和 Promise A+ 规范

## 关键特性

- **多层循环嵌套**: 主循环 → 平台任务循环 → 前台任务循环
- **任务队列分离**: 不同类型任务使用独立队列管理
- **优先级调度**: 确保关键任务及时执行
- **死锁预防**: 通过特殊的任务调度策略避免死锁
- **资源管理**: 自动清理和释放相关资源

## 调试验证

### 断点调试支持

本分析提供了完整的断点调试环境，支持源码级别验证事件循环流程：

#### 调试文件

- **[debug-event-loop.js](./debug-event-loop.js)**: JavaScript 层面的事件循环测试和断点调试
- **[.vscode/launch.json](./debug/.vscode/launch.json)**: VS Code 调试配置，支持多种调试模式
- **[DEBUG.md](./DEBUG.md)**: 详细的调试指南和使用说明

#### 支持的调试模式

1. **JavaScript 层面调试**
   - 标准 Node.js 调试
   - 源码映射调试
   - Inspector 协议调试

2. **C++ 源码调试**
   - lldb/gdb 原生调试
   - VS Code 混合调试
   - 函数级断点设置

3. **性能分析调试**
   - 事件循环延迟监控
   - 内存使用跟踪
   - 异步操作性能分析

#### 关键调试点

**JavaScript 层面** (23 个断点位置):

```javascript
// process.nextTick 优先级验证
process.nextTick(() => {
  console.log('nextTick 回调执行'); // 断点 1
});

// Promise 微任务执行
Promise.resolve().then(() => {
  console.log('Promise 微任务执行'); // 断点 3
});

// setImmediate 宏任务执行  
setImmediate(() => {
  console.log('setImmediate 回调执行'); // 断点 2
});
```

**C++ 源码层面**:

```cpp
// 主事件循环入口
Maybe<ExitCode> SpinEventLoopInternal(Environment* env) {
  // 断点: 验证主循环逻辑
}

// 平台任务处理
void NodePlatform::DrainTasks(Isolate* isolate) {
  // 断点: 验证任务队列处理
}

// 前台任务队列处理
bool FlushForegroundTasksInternal() {
  // 断点: 验证微任务执行
}
```

#### 验证流程示例

**执行顺序验证**:

```bash
# 启动调试
node --inspect-brk analysis/debug-event-loop.js

# 预期输出顺序:
# 1. 同步代码
# 2. process.nextTick (最高优先级)
# 3. Promise 微任务
# 4. setImmediate (Check 阶段)
```

**性能监控**:

```javascript
// 监控事件循环延迟
const start = process.hrtime.bigint();
setImmediate(() => {
  const delay = process.hrtime.bigint() - start;
  console.log(`事件循环延迟: ${Number(delay) / 1000000}ms`);
});
```

通过这些调试工具，可以实时验证事件循环的执行顺序、性能特征和内部机制，确保理论分析与实际实现的一致性。
