# Node.js 事件循环分析

## 概述

Node.js 事件循环是一个多层次、多队列的复杂系统，协调处理各种异步操作。本文基于源码分析整个执行流程。

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

```
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

```
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