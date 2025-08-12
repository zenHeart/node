
/**
 * Node.js 事件循环源码分析：
 * 
 * 核心实现在 src/api/embed_helpers.cc:
 * ```cpp
 * do {
 *   // 1. 运行 libuv 事件循环 (包含 7 个阶段)
 *   uv_run(env->event_loop(), UV_RUN_DEFAULT);
 *   
 *   // 2. 排空微任务队列 (Promise、queueMicrotask 等)
 *   platform->DrainTasks(isolate);
 *   
 *   // 3. 检查是否还有活跃事件
 *   more = uv_loop_alive(env->event_loop());
 * } while (more && !env->is_stopping());
 * ```
 * 
 * 重要发现：微任务不是在每个 libuv 阶段间处理，而是在整轮 uv_run 后处理！
 * 这解释了为什么 Promise 和 nextTick 会在 setImmediate 之前执行。
 */

// 测试 setImmediate 的延迟特性
console.log('=== setImmediate 延迟测试 ===');

setTimeout(() => console.log('1. setTimeout(0)'), 0);
Promise.resolve().then(() => console.log('2. Promise'));
process.nextTick(() => console.log('3. process.nextTick'));
setImmediate(() => console.log('4. setImmediate'));

console.log('\n=== 真实的事件循环机制 ===');
console.log('基于 Node.js 源码分析：');
console.log('');
console.log('每轮事件循环：');
console.log('1. uv_run() 执行完整的 libuv 循环：');
console.log('   - timer 阶段     (setTimeout/setInterval)');
console.log('   - pending 阶段   (延迟的 I/O 回调)');  
console.log('   - idle 阶段      (内部使用)');
console.log('   - prepare 阶段   (内部使用)');
console.log('   - poll 阶段      (I/O 事件轮询)');
console.log('   - check 阶段     (setImmediate)');
console.log('   - close 阶段     (关闭回调)');
console.log('');
console.log('2. platform->DrainTasks() 处理所有微任务：');
console.log('   - process.nextTick');
console.log('   - Promise.then/catch/finally');
console.log('   - queueMicrotask');
console.log('');
console.log('3. 检查是否还有活跃事件，如有则重复步骤1-2');

console.log('\n=== 为什么 Promise 比 setImmediate 先执行？===');
console.log('答案：微任务在整轮 libuv 循环后统一处理！');
console.log('即使 setImmediate 在当前循环的 check 阶段已经执行，');
console.log('Promise 微任务也会在下一轮循环开始前先执行。');
console.log('');
console.log('执行流程：');
console.log('1. 主代码执行完毕');
console.log('2. 开始事件循环第一轮');
console.log('3. timer 阶段 - 执行 setTimeout(0)');
console.log('4. timer 阶段结束，处理微任务：');
console.log('   → process.nextTick');
console.log('   → Promise.then');
console.log('5. pending 阶段（无任务）');
console.log('6. idle 阶段（内部使用）');
console.log('7. prepare 阶段（内部使用）');
console.log('8. poll 阶段（无 I/O 事件）');
console.log('9. check 阶段 - 执行 setImmediate');
console.log('');
console.log('所以 setImmediate 最后执行！');

console.log('\n=== 各阶段详细说明 ===');
console.log('pending 阶段：处理一些延迟的 I/O 回调');
console.log('- 例如：TCP 连接错误、写入错误等延迟回调');
console.log('idle/prepare 阶段：libuv 内部使用');
console.log('- 用于内部管理，用户代码不直接接触');

// 测试微任务在各阶段间的执行
console.log('\n=== 验证微任务在各阶段间执行 ===');
setTimeout(() => {
  console.log('Timer 阶段');
  process.nextTick(() => console.log('  Timer 后的 nextTick'));
  Promise.resolve().then(() => console.log('  Timer 后的 Promise'));
}, 0);

setImmediate(() => {
  console.log('Check 阶段');
  process.nextTick(() => console.log('  Check 后的 nextTick'));
  Promise.resolve().then(() => console.log('  Check 后的 Promise'));
});

// 在 I/O 回调中的情况
const fs = require('fs');
console.log('\n=== 在 I/O (poll) 回调中的执行顺序 ===');
console.log('当在 poll 阶段的回调中调用 setImmediate：');
fs.readFile(__filename, () => {
  console.log('  → 当前处于 poll 阶段的回调中');
  setTimeout(() => console.log('  → setTimeout(0) - 下一轮 timer 阶段'), 0);
  setImmediate(() => console.log('  → setImmediate - 本轮 check 阶段'));
  console.log('  → setImmediate 会在当前事件循环的 check 阶段执行');
  console.log('  → setTimeout 会在下一轮事件循环的 timer 阶段执行');
});
