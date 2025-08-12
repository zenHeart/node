#!/usr/bin/env node

console.log('=== process.nextTick 实现机制验证 ===\n');

let step = 0;
function log(msg) {
    console.log(`${++step}. ${msg}`);
}

log('开始测试');

// 1. 基本 nextTick
process.nextTick(() => {
    log('nextTick 1 执行');
});

// 2. 带参数的 nextTick
process.nextTick((arg1, arg2) => {
    log(`nextTick 2 执行，参数: ${arg1}, ${arg2}`);
}, 'hello', 'world');

// 3. Promise 微任务
Promise.resolve().then(() => {
    log('Promise 微任务执行');
});

// 4. 嵌套 nextTick
process.nextTick(() => {
    log('外层 nextTick 执行');
    
    process.nextTick(() => {
        log('内层 nextTick 执行');
    });
    
    Promise.resolve().then(() => {
        log('nextTick 中的 Promise 微任务');
    });
});

// 5. setImmediate 对比
setImmediate(() => {
    log('setImmediate 执行');
    
    process.nextTick(() => {
        log('setImmediate 中的 nextTick');
    });
});

// 6. 多个 nextTick
for (let i = 0; i < 3; i++) {
    process.nextTick((index) => {
        log(`循环 nextTick ${index} 执行`);
    }, i);
}

log('同步代码结束');

console.log('\n预期执行顺序：');
console.log('1. 开始测试');
console.log('2. 同步代码结束');
console.log('3-8. 所有 nextTick 回调（按添加顺序）');
console.log('9. Promise 微任务执行');
console.log('10. nextTick 中的 Promise 微任务');
console.log('11. setImmediate 执行');
console.log('12. setImmediate 中的 nextTick');
