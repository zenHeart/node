#!/usr/bin/env node

console.log('=== 微任务在 setImmediate 处理过程中的执行时机测试 ===\n');

// 测试计数器
let step = 0;

function log(message) {
    console.log(`${++step}. ${message}`);
}

// 创建一些微任务和 setImmediate
log('开始测试');

setImmediate(() => {
    log('setImmediate 1 执行');
});

Promise.resolve().then(() => {
    log('Promise 微任务 1 执行');
});

process.nextTick(() => {
    log('nextTick 1 执行');
});

setImmediate(() => {
    log('setImmediate 2 执行');
    
    // 在 setImmediate 回调中创建新的微任务
    Promise.resolve().then(() => {
        log('setImmediate 2 内部的 Promise 微任务执行');
    });
    
    process.nextTick(() => {
        log('setImmediate 2 内部的 nextTick 执行');
    });
});

Promise.resolve().then(() => {
    log('Promise 微任务 2 执行');
});

setImmediate(() => {
    log('setImmediate 3 执行');
});

log('同步代码结束');

console.log('\n预期执行顺序：');
console.log('1. 开始测试');
console.log('2. 同步代码结束');
console.log('3. nextTick 1 执行');
console.log('4. Promise 微任务 1 执行');
console.log('5. Promise 微任务 2 执行');
console.log('6. setImmediate 1 执行');
console.log('7. setImmediate 2 执行');
console.log('8. setImmediate 2 内部的 nextTick 执行');
console.log('9. setImmediate 2 内部的 Promise 微任务执行');
console.log('10. setImmediate 3 执行');
