# Node.js 事件循环：V8 与 Node.js 控制权交换机制详解

## 完整事件循环架构

```text
┌─────────────────────────────────────────────────────┐
│                Node.js 主循环                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │            同步代码执行阶段                       │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │          V8 JavaScript 执行                 │ │ │
│  │  │  - 同步 JavaScript 代码                     │ │ │
│  │  │  - require() 模块加载                       │ │ │
│  │  │  - 函数调用栈执行                            │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│                         ↓                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │           libuv 事件循环阶段                      │ │
│  │                                                 │ │
│  │  1. Timer Phase                                 │ │
│  │     ├── setTimeout 回调                         │ │
│  │     ├── setInterval 回调                        │ │
│  │     └── 每个回调执行后: 控制权交换 ──────────────┐ │ │
│  │                                                ↓ │ │
│  │  2. Pending Callbacks Phase                   ┌─┴─┐│
│  │     ├── I/O 异常回调                           │ ↓ ││
│  │     ├── TCP 错误回调                           │ ↓ ││
│  │     └── 每个回调执行后: 控制权交换 ─────────────┤ ↓ ││
│  │                                                │ ↓ ││
│  │  3. Poll Phase                                 │ ↓ ││
│  │     ├── 新的 I/O 事件                          │ ↓ ││
│  │     ├── 文件读写回调                            │ ↓ ││
│  │     ├── 网络请求回调                            │ ↓ ││
│  │     └── 每个回调执行后: 控制权交换 ─────────────┤ ↓ ││
│  │                                                │ ↓ ││
│  │  4. Check Phase                                │ ↓ ││
│  │     ├── setImmediate 回调                      │ ↓ ││
│  │     └── 每个回调执行后: 控制权交换 ─────────────┤ ↓ ││
│  │                                                │ ↓ ││
│  │  5. Close Callbacks Phase                      │ ↓ ││
│  │     ├── socket.on('close', ...)               │ ↓ ││
│  │     ├── server.on('close', ...)               │ ↓ ││
│  │     └── 每个回调执行后: 控制权交换 ─────────────┘ ↓ ││
│  │                                                  ↓ ││
│  └──────────────────────────────────────────────────┘ ││
│                         ↓                            ↓ ││
│  ┌─────────────────────────────────────────────────┐ ↓ ││
│  │             平台任务处理 (DrainTasks)            │ ↓ ││
│  │  - Worker 线程任务                              │ ↓ ││
│  │  - 其他平台相关任务                              │ ↓ ││
│  └─────────────────────────────────────────────────┘ ↓ ││
│                         ↓                            ↓ ││
│  ┌─────────────────────────────────────────────────┐ ↓ ││
│  │            控制权交换处理逻辑                     │ ←─┘ ││
│  │         (InternalCallbackScope::Close)          │   ││
│  │                                                 │   ││
│  │  if (有 nextTick 任务) {                        │   ││
│  │      ┌─────────────────────────────────────────┐ │   ││
│  │      │        Node.js 控制阶段                  │ │   ││
│  │      │  - 执行 nextTick 回调                   │ │   ││
│  │      │  - 执行 Promise rejection 处理          │ │   ││
│  │      │  - 保持 Node.js 控制权                  │ │   ││
│  │      └─────────────────────────────────────────┘ │   ││
│  │  } else {                                       │   ││
│  │      ┌─────────────────────────────────────────┐ │   ││
│  │      │        V8 控制阶段                       │ │   ││
│  │      │  context->GetMicrotaskQueue()           │ │   ││
│  │      │    ->PerformCheckpoint(isolate)         │ │   ││
│  │      │                                         │ │   ││
│  │      │  ┌─────────────────────────────────────┐│ │   ││
│  │      │  │     V8 Microtask 执行循环            ││ │   ││
│  │      │  │                                     ││ │   ││
│  │      │  │  For each Promise microtask:        ││ │   ││
│  │      │  │    1. RunPromiseHook(kBefore) ──────┼┼─┼───┘│
│  │      │  │       ↓ 控制权临时转给 Node.js       ││ │    │
│  │      │  │    2. 执行 Promise 回调              ││ │    │
│  │      │  │    3. RunPromiseHook(kAfter) ───────┼┼─┼────│
│  │      │  │       ↓ 控制权临时转给 Node.js       ││ │    │
│  │      │  │                                     ││ │    │
│  │      │  │  For each 其他 microtask:           ││ │    │
│  │      │  │    - queueMicrotask 回调             ││ │    │
│  │      │  │    - MutationObserver 回调           ││ │    │
│  │      │  └─────────────────────────────────────┘│ │    │
│  │      └─────────────────────────────────────────┘ │    │
│  │  }                                               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 控制权交换的关键机制

### 1. InternalCallbackScope 的作用

```cpp
// 每个 libuv 回调执行时的包装
InternalCallbackScope scope(env, object, asyncContext);
// 执行用户回调...
// 析构函数自动调用 Close()
```

### 2. Close() 方法的决策逻辑

```cpp
void InternalCallbackScope::Close() {
  // 关键判断：是否有嵌套的回调作用域
  if (env_->async_callback_scope_depth() > 1 || skip_task_queues_) {
    return; // 嵌套情况下不处理微任务
  }

  TickInfo* tick_info = env_->tick_info();

  // 优先级 1: nextTick 队列（Node.js 控制）
  if (!tick_info->has_tick_scheduled()) {
    // 优先级 2: V8 microtask 队列（V8 控制，但有 Promise hooks）
    context->GetMicrotaskQueue()->PerformCheckpoint(isolate);
  }

  // 优先级 3: nextTick + rejection 处理（Node.js 控制）
  if (tick_info->has_tick_scheduled() || tick_info->has_rejection_to_warn()) {
    // 调用 Node.js 的 tick 处理函数
    Local<Function> tick_callback = env_->tick_callback_function();
    tick_callback->Call(context, process, 0, nullptr);
  }
}
```

### 3. V8 Microtask 执行中的控制权交换

```cpp
// V8 内部：builtins-microtask-queue-gen.cc
void MicrotaskQueueBuiltinsAssembler::RunPromiseJob() {
  // 每个 Promise microtask 执行前
  RunAllPromiseHooks(PromiseHookType::kBefore, context, promise);
  //                     ↑
  //                 控制权转给 Node.js
  
  // 执行 Promise 回调（V8 控制）
  CallBuiltin(Builtin::kPromiseFulfillReactionJob, ...);
  
  // 每个 Promise microtask 执行后
  RunAllPromiseHooks(PromiseHookType::kAfter, context, promise);
  //                     ↑
  //                 控制权转给 Node.js
}
```

### 4. Promise Hook 的实现

```javascript
// lib/internal/promise_hooks.js
function update() {
  const init = maybeFastPath(hooks.init, initAll);
  const before = maybeFastPath(hooks.before, beforeAll);
  const after = maybeFastPath(hooks.after, afterAll);
  const settled = maybeFastPath(hooks.settled, settledAll);
  
  // 关键：将 Node.js 函数注册到 V8
  setPromiseHooks(init, before, after, settled);
  //              ↑
  //         通过 C++ 绑定注册到 V8 Context
}
```

```cpp
// src/env.cc - Promise hooks 的 C++ 实现
void Environment::ResetPromiseHooks(...) {
  async_hooks()->ResetPromiseHooks(init, before, after, resolve);
  
  // 将 Node.js 函数注册到 V8 Context
  context()->SetPromiseHooks(init, before, after, resolve);
  //          ↑
  //      V8 会在执行 Promise 时调用这些函数
}
```

## 详细执行时序

### 阶段 1: 同步代码执行

```text
Node.js 启动 → V8 执行同步 JS 代码 → 注册异步操作 → 同步代码完成
```

### 阶段 2: libuv 事件循环各阶段

```text
Timer Phase:
  setTimeout(() => console.log('timer'), 0)
  └── InternalCallbackScope scope(...)
      ├── 执行回调: console.log('timer')
      └── scope.Close()
          ├── 检查 nextTick: 无
          ├── PerformCheckpoint(): 执行 Promise microtasks
          │   └── Promise hooks 提供 Node.js 控制点
          └── 最终检查 nextTick + rejections

Pending Phase:
  I/O 异常回调
  └── 同样的 InternalCallbackScope 包装和 Close() 逻辑

Poll Phase:
  fs.readFile('file', (err, data) => { ... })
  └── InternalCallbackScope scope(...)
      ├── 执行回调: 用户的文件读取回调
      └── scope.Close()
          ├── 可能有 nextTick 从回调中添加
          ├── PerformCheckpoint(): 处理任何新的 Promise
          └── 处理 nextTick + rejections

Check Phase:
  setImmediate(() => console.log('immediate'))
  └── InternalCallbackScope scope(...)
      ├── 执行回调: console.log('immediate')
      └── scope.Close() - 同样的逻辑

Close Phase:
  socket.on('close', () => { ... })
  └── 同样的包装和处理逻辑
```

### 阶段 3: 平台任务处理 (DrainTasks)

```text
SpinEventLoopInternal() 中每轮循环结束后:
├── platform->DrainTasks(isolate)
│   ├── Worker 线程任务
│   ├── Platform 相关任务  
│   └── V8 平台任务
└── FlushForegroundTasksInternal()
    └── 处理 V8 前台任务队列
```

## 关键控制权交换点

### 1. Node.js → V8

- `context->GetMicrotaskQueue()->PerformCheckpoint(isolate)`
- Node.js 主动让 V8 处理微任务队列

### 2. V8 → Node.js

- `RunPromiseHook(kBefore/kAfter)`
- V8 在每个 Promise 执行前后回调 Node.js

### 3. 控制权优先级

```text
1. nextTick 队列 (Node.js 最高优先级)
2. Promise microtasks (V8 控制，Node.js 通过 hooks 监听)
3. nextTick + rejection 处理 (Node.js 清理阶段)
```

## 实际执行示例

### 示例 1: 复杂的异步执行顺序

```javascript
console.log('1: 同步代码开始');

setTimeout(() => console.log('2: Timer Phase'), 0);

setImmediate(() => {
  console.log('3: Check Phase');
  process.nextTick(() => console.log('4: nextTick from setImmediate'));
  Promise.resolve().then(() => console.log('5: Promise from setImmediate'));
});

process.nextTick(() => console.log('6: nextTick'));
Promise.resolve().then(() => console.log('7: Promise'));

console.log('8: 同步代码结束');
```

**执行流程分析：**

```text
1. 同步执行阶段 (V8 控制):
   输出: "1: 同步代码开始"
   注册: setTimeout, setImmediate, nextTick, Promise
   输出: "8: 同步代码结束"

2. 同步代码结束后的微任务处理:
   ├── nextTick 优先: "6: nextTick"
   └── Promise microtask: "7: Promise"

3. libuv 事件循环开始:
   
   Timer Phase:
   ├── 执行 setTimeout 回调
   │   └── InternalCallbackScope::Close()
   │       ├── 无 nextTick
   │       └── 无新 Promise
   └── 输出: "2: Timer Phase"
   
   Poll Phase: (无 I/O 事件)
   
   Check Phase:
   ├── 执行 setImmediate 回调
   │   ├── 输出: "3: Check Phase"
   │   ├── 注册新的 nextTick 和 Promise
   │   └── InternalCallbackScope::Close()
   │       ├── nextTick 优先: "4: nextTick from setImmediate"
   │       └── Promise microtask: "5: Promise from setImmediate"
   └── 回调完成
```

### 示例 2: Promise hooks 的控制权交换

```javascript
const { onBefore, onAfter } = require('internal/promise_hooks');

// 注册 Promise hooks
onBefore((promise) => console.log('Hook: Promise before'));
onAfter((promise) => console.log('Hook: Promise after'));

setImmediate(() => {
  console.log('setImmediate callback');
  Promise.resolve().then(() => console.log('Promise in setImmediate'));
});
```

**控制权交换流程：**

```text
Check Phase 执行:
├── InternalCallbackScope scope(...) 创建
├── 执行用户回调:
│   ├── 输出: "setImmediate callback"
│   └── 创建 Promise microtask
├── scope.Close() 调用:
│   ├── 无 nextTick，调用 PerformCheckpoint()
│   ├── V8 开始处理 Promise microtask:
│   │   ├── RunPromiseHook(kBefore) → Node.js 控制
│   │   │   └── 输出: "Hook: Promise before"
│   │   ├── 执行 Promise 回调 → V8 控制
│   │   │   └── 输出: "Promise in setImmediate"  
│   │   └── RunPromiseHook(kAfter) → Node.js 控制
│   │       └── 输出: "Hook: Promise after"
│   └── 微任务处理完成，返回 Node.js 控制
└── InternalCallbackScope 析构完成
```

## 总结：完整的协作机制

1. **Node.js 主导**: 控制事件循环的整体节奏和阶段
2. **V8 协作**: 处理 JavaScript 执行和微任务队列
3. **双向通信**:
   - Node.js 通过 `PerformCheckpoint` 让 V8 处理微任务
   - V8 通过 Promise hooks 让 Node.js 参与 Promise 生命周期
4. **优先级明确**: nextTick > Promise microtasks > 其他微任务
5. **嵌套保护**: 通过 `async_callback_scope_depth` 防止递归处理

这种设计确保了 Node.js 能够精确控制异步执行的时机，同时充分利用 V8 的微任务处理能力，实现了两个引擎之间的无缝协作。
