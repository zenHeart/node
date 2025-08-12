// 深入测试：V8 与 Node.js 控制权交换机制
console.log('=== V8-Node.js 控制权交换测试 ===\n');

// 模拟 Promise hook（在实际 Node.js 内部这是 C++ 实现）
console.log('模拟 Promise hook 注册...');

console.log('\n1. 同步代码执行阶段 (V8 控制)');

setImmediate(() => {
  console.log('\n2. Check Phase 开始 (Node.js 控制)');
  console.log('   InternalCallbackScope 创建');
  console.log('   执行 setImmediate 回调');
  
  // 在回调中创建 Promise
  Promise.resolve('data').then((data) => {
    console.log('     Promise 回调执行:', data);
    console.log('     这里运行在 V8 microtask 中');
    return 'processed';
  }).then((result) => {
    console.log('     链式 Promise 回调:', result);
  });
  
  process.nextTick(() => {
    console.log('   nextTick 回调执行 (优先级最高)');
  });
  
  console.log('   setImmediate 回调执行完毕');
  console.log('   即将调用 InternalCallbackScope::Close()');
  console.log('\n3. 控制权交换处理:');
  console.log('   - 检查 nextTick 队列: 有任务');
  console.log('   - 执行 nextTick (Node.js 控制)');
  console.log('   - 调用 PerformCheckpoint (转给 V8)');
  console.log('   - V8 处理 Promise microtasks:');
  console.log('     * RunPromiseHook(kBefore) - 控制权回到 Node.js');
  console.log('     * 执行 Promise 回调 - V8 控制');  
  console.log('     * RunPromiseHook(kAfter) - 控制权回到 Node.js');
  console.log('   - 所有微任务完成，控制权回到 Node.js');
  console.log('   InternalCallbackScope 析构');
});

// 测试嵌套回调的深度控制
setTimeout(() => {
  console.log('\n4. Timer Phase (Node.js 控制)');
  console.log('   async_callback_scope_depth = 1');
  
  // 这会增加深度
  process.nextTick(() => {
    console.log('   Timer 中的 nextTick');
    console.log('   async_callback_scope_depth = 2 (嵌套)');
    console.log('   由于深度 > 1, 不会处理微任务');
    
    Promise.resolve().then(() => {
      console.log('   这个 Promise 会延迟到上层 Close()');
    });
  });
  
  console.log('   Timer 回调完成，调用 Close()');
  console.log('   depth = 1, 会处理积累的微任务');
}, 10);

console.log('\n同步代码执行完毕');
console.log('等待事件循环处理异步任务...\n');
