// 测试控制权转移时机
// 验证是否只有异步执行时才转移控制权

console.log('=== 控制权转移时机验证 ===\n');

// 1. 纯同步代码中的控制权转移
console.log('1. 测试同步代码后的控制权转移:');
console.log('  - 创建 Promise (但还没转移控制权)');

Promise.resolve('同步后的Promise').then(value => {
  console.log(`  ✓ ${value} - 这证明同步代码结束后发生了控制权转移`);
});

console.log('  - 同步代码继续执行');
console.log('  - 同步代码执行完毕\n');

// 2. 嵌套异步中的控制权转移时机
setTimeout(() => {
  console.log('2. 测试异步回调中的控制权转移:');
  
  console.log('  - Timer 回调开始执行');
  
  // 在异步回调中创建微任务
  Promise.resolve('Timer中的Promise').then(value => {
    console.log(`  ✓ ${value} - Timer回调完成后才转移控制权`);
  });
  
  // 嵌套的 nextTick 不会立即触发控制权转移
  process.nextTick(() => {
    console.log('  ✓ nextTick执行 - 外层回调完成后统一处理');
    
    Promise.resolve('nextTick中的Promise').then(value => {
      console.log(`  ✓ ${value} - 最深层的微任务`);
    });
  });
  
  console.log('  - Timer 回调即将结束');
  
}, 0);

// 3. 验证同步代码中立即可用的 Promise
console.log('3. 测试已解决的 Promise:');
const resolvedPromise = Promise.resolve('立即可用的Promise');
resolvedPromise.then(value => {
  console.log(`  ✓ ${value} - 证明不需要异步操作也能转移控制权`);
});

// 4. 混合场景：同步创建，异步处理
console.log('4. 测试混合场景:');
const promises = [];
for (let i = 0; i < 3; i++) {
  promises.push(
    Promise.resolve(`批量Promise-${i}`).then(value => {
      console.log(`  ✓ ${value}`);
      return value;
    })
  );
}

Promise.all(promises).then(() => {
  console.log('  ✓ 所有批量Promise完成 - 控制权转移是按需发生的\n');
  
  // 5. 最终验证：嵌套深度对控制权转移的影响
  console.log('5. 测试嵌套深度的影响:');
  
  setTimeout(() => {
    console.log('  - 外层 Timer');
    
    Promise.resolve().then(() => {
      console.log('  ✓ 外层 Timer 的 Promise');
      
      setTimeout(() => {
        console.log('  - 内层 Timer');
        
        Promise.resolve().then(() => {
          console.log('  ✓ 内层 Timer 的 Promise');
          console.log('\n=== 结论验证完成 ===');
          console.log('控制权转移发生在微任务检查点，不仅限于异步执行！');
        });
        
      }, 0);
    });
    
  }, 10);
});

console.log('5. 所有同步代码执行完毕，等待控制权转移...\n');
