// 测试 Promise 微任务是否会导致 I/O 饥饿
console.log('开始测试 Promise 微任务饥饿');

let promiseCount = 0;
let timeoutExecuted = false;
let immediateExecuted = false;

// 设置一个定时器和 setImmediate 来测试是否会被阻塞
setTimeout(() => {
  console.log('setTimeout 执行了!');
  timeoutExecuted = true;
}, 0);

setImmediate(() => {
  console.log('setImmediate 执行了!');
  immediateExecuted = true;
});

// 添加 nextTick 来测试它与 Promise 的关系
process.nextTick(() => {
  console.log('nextTick 1 执行了!');
});

// 创建大量的 Promise 微任务
function createPromiseChain() {
  promiseCount++;
  if (promiseCount < 10000) {  // 减少数量以便观察
    Promise.resolve().then(() => {
      if (promiseCount % 1000 === 0) {
        console.log(`Promise 微任务 ${promiseCount} 执行`);
        // 在 Promise 中添加 nextTick
        process.nextTick(() => {
          console.log(`nextTick in Promise ${promiseCount} 执行了!`);
        });
      }
      createPromiseChain();
    });
  } else {
    console.log('Promise 链条完成');
    console.log(`超时是否执行: ${timeoutExecuted}`);
    console.log(`setImmediate 是否执行: ${immediateExecuted}`);
    
    // 在最后添加 nextTick
    process.nextTick(() => {
      console.log('nextTick 最后执行了!');
    });
  }
}

// 开始 Promise 链条
createPromiseChain();

console.log('同步代码完成');
