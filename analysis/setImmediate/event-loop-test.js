// 测试 Node.js 事件循环和 V8 控制权交换
console.log('=== Node.js 事件循环测试 ===\n');

console.log('1: 同步代码开始');

// Timer Phase 回调
setTimeout(() => {
  console.log('2: Timer Phase - setTimeout');
  process.nextTick(() => console.log('3: nextTick from Timer'));
  Promise.resolve().then(() => console.log('4: Promise from Timer'));
}, 0);

// Check Phase 回调  
setImmediate(() => {
  console.log('5: Check Phase - setImmediate');
  process.nextTick(() => console.log('6: nextTick from Check'));
  Promise.resolve().then(() => console.log('7: Promise from Check'));
  
  // 嵌套 setImmediate 测试下一轮循环
  setImmediate(() => {
    console.log('8: Nested setImmediate (next loop)');
  });
});

// 当前执行栈的微任务
process.nextTick(() => {
  console.log('9: nextTick 1');
  process.nextTick(() => console.log('10: nextTick nested'));
});

process.nextTick(() => console.log('11: nextTick 2'));

Promise.resolve().then(() => {
  console.log('12: Promise 1');
  return Promise.resolve();
}).then(() => {
  console.log('13: Chained Promise');
});

Promise.resolve().then(() => console.log('14: Promise 2'));

console.log('15: 同步代码结束');

console.log('\n=== 预期输出顺序 ===');
console.log('1: 同步代码开始');
console.log('15: 同步代码结束');
console.log('9: nextTick 1');
console.log('11: nextTick 2'); 
console.log('10: nextTick nested');
console.log('12: Promise 1');
console.log('14: Promise 2');
console.log('13: Chained Promise');
console.log('2: Timer Phase - setTimeout');
console.log('3: nextTick from Timer');
console.log('4: Promise from Timer');
console.log('5: Check Phase - setImmediate');
console.log('6: nextTick from Check');
console.log('7: Promise from Check');
console.log('8: Nested setImmediate (next loop)');
