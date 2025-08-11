/**
 * Node.js 事件循环调试验证脚本
 * 用于断点调试验证事件循环执行顺序和流程
 * 
 * 使用 Node.js 原生的 --enable-source-maps 支持
 * 无需额外安装 source-map-support 包
 */

// 调试标志
const DEBUG = true;

function log(message, ...args) {
  if (DEBUG) {
    console.log(`[${new Date().toISOString()}] ${message}`, ...args);
  }
}

function logPhase(phase, description) {
  log(`\n=== ${phase} ===`);
  log(description);
}

// 验证 process.nextTick 执行时机
function testNextTick() {
  logPhase('NextTick Test', '验证 process.nextTick 优先级');
  
  console.log('1. 同步代码开始');
  
  // 设置断点: 验证 nextTick 在同步代码后立即执行
  process.nextTick(() => {
    console.log('4. process.nextTick 回调执行'); // 断点 1
  });
  
  console.log('2. 同步代码继续');
  
  setImmediate(() => {
    console.log('6. setImmediate 回调执行'); // 断点 2
  });
  
  Promise.resolve().then(() => {
    console.log('5. Promise 微任务执行'); // 断点 3
  });
  
  console.log('3. 同步代码结束');
}

// 验证 setTimeout vs setImmediate 在不同上下文中的行为
function testTimeoutVsImmediate() {
  logPhase('setTimeout vs setImmediate', '验证在不同上下文中的执行顺序');
  
  console.log('=== 在主模块中（非I/O周期）===');
  // 在主模块中，执行顺序是不确定的
  setTimeout(() => {
    console.log('主模块: setTimeout(0)'); // 断点 4a
  }, 0);
  
  setImmediate(() => {
    console.log('主模块: setImmediate'); // 断点 4b
  });
  
  console.log('=== 在I/O周期中 ===');
  // 在I/O回调中，setImmediate总是先执行
  require('fs').readFile(__filename, () => {
    setTimeout(() => {
      console.log('I/O回调中: setTimeout(0)'); // 断点 4c
    }, 0);
    
    setImmediate(() => {
      console.log('I/O回调中: setImmediate'); // 断点 4d
    });
  });
}

// 验证定时器精度和长时间运行回调的影响
function testTimerPrecision() {
  logPhase('Timer Precision Test', '验证定时器精度和长时间回调的影响');
  
  const timeoutScheduled = Date.now();
  
  // 模拟文档中的例子：95ms的文件读取 + 10ms的处理时间
  require('fs').readFile(__filename, () => {
    console.log('文件读取完成，开始处理...'); // 断点 5a
    const startCallback = Date.now();
    
    // 模拟10ms的处理时间
    while (Date.now() - startCallback < 10) {
      // 阻塞操作
    }
    console.log('文件处理完成'); // 断点 5b
  });
  
  setTimeout(() => {
    const delay = Date.now() - timeoutScheduled;
    console.log(`定时器延迟: ${delay}ms (预期100ms)`); // 断点 5c
  }, 100);
}

// 验证微任务和宏任务混合执行
function testMixedTasks() {
  logPhase('Mixed Tasks Test', '验证微任务和宏任务混合执行');
  
  console.log('开始混合任务测试');
  
  // 宏任务
  setTimeout(() => {
    console.log('宏任务: setTimeout'); // 断点 6
    
    // 在宏任务中添加微任务
    Promise.resolve().then(() => {
      console.log('微任务: 宏任务中的 Promise'); // 断点 7
    });
    
    process.nextTick(() => {
      console.log('微任务: 宏任务中的 nextTick'); // 断点 8
    });
  }, 0);
  
  // 微任务
  Promise.resolve().then(() => {
    console.log('微任务: Promise'); // 断点 9
    
    // 在微任务中添加更多微任务
    return Promise.resolve();
  }).then(() => {
    console.log('微任务: 链式 Promise'); // 断点 10
  });
  
  // nextTick
  process.nextTick(() => {
    console.log('微任务: nextTick'); // 断点 11
  });
  
  // setImmediate
  setImmediate(() => {
    console.log('宏任务: setImmediate'); // 断点 12
  });
}

// 验证 process.nextTick 的"饿死"现象
function testNextTickStarvation() {
  logPhase('NextTick Starvation Test', '演示 process.nextTick 如何饿死 I/O');
  
  let count = 0;
  const maxCount = 10; // 限制递归次数避免真正饿死
  
  console.log('开始递归 nextTick...'); // 断点 13a
  
  function recursiveNextTick() {
    if (count++ < maxCount) {
      console.log(`递归 nextTick ${count}`); // 断点 13b
      process.nextTick(recursiveNextTick);
    } else {
      console.log('停止递归 nextTick'); // 断点 13c
    }
  }
  
  // 启动递归
  process.nextTick(recursiveNextTick);
  
  // 这个 I/O 操作会被延迟到所有 nextTick 完成后
  require('fs').readFile(__filename, () => {
    console.log('I/O 操作完成（被 nextTick 延迟）'); // 断点 13d
  });
  
  // 这个 setImmediate 也会被延迟
  setImmediate(() => {
    console.log('setImmediate 执行（被 nextTick 延迟）'); // 断点 13e
  });
}

// 验证 EventEmitter 构造函数中的事件发射
function testEventEmitterTiming() {
  logPhase('EventEmitter Timing Test', '验证构造函数中事件发射的时机');
  
  const EventEmitter = require('events');
  
  // 错误的方式：立即发射事件
  console.log('=== 错误的事件发射方式 ===');
  class BadEmitter extends EventEmitter {
    constructor() {
      super();
      this.emit('event'); // 这时还没有监听器
    }
  }
  
  const badEmitter = new BadEmitter();
  badEmitter.on('event', () => {
    console.log('BadEmitter: 事件被捕获'); // 这不会执行
  });
  
  // 正确的方式：使用 nextTick
  console.log('=== 正确的事件发射方式 ===');
  class GoodEmitter extends EventEmitter {
    constructor() {
      super();
      // 使用 nextTick 确保监听器已设置
      process.nextTick(() => {
        this.emit('event'); // 断点 14a
      });
    }
  }
  
  const goodEmitter = new GoodEmitter();
  goodEmitter.on('event', () => {
    console.log('GoodEmitter: 事件被捕获'); // 断点 14b
  });
}

// 验证 API 设计中的异步一致性
function testAsyncConsistency() {
  logPhase('Async Consistency Test', '验证 API 异步一致性设计');
  
  let bar = null;
  
  // 错误的异步API设计：同步执行回调
  function badAsyncApiCall(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }
    callback(); // 同步执行
  }
  
  console.log('=== 错误的异步 API ===');
  badAsyncApiCall(() => {
    console.log('badApi: bar =', bar); // null，因为同步执行
  });
  bar = 1;
  
  // 正确的异步API设计：使用 nextTick
  function goodAsyncApiCall(callback) {
    if (typeof callback !== 'function') {
      return process.nextTick(
        () => callback(new TypeError('callback must be a function'))
      );
    }
    process.nextTick(callback); // 异步执行
  }
  
  console.log('=== 正确的异步 API ===');
  bar = null;
  goodAsyncApiCall(() => {
    console.log('goodApi: bar =', bar); // 断点 15a - 应该是 1
  });
  bar = 1;
}

// 验证事件循环各阶段的详细行为
function testEventLoopPhasesDetailed() {
  logPhase('Event Loop Phases Detailed', '详细验证事件循环各个阶段');
  
  let phaseCounter = 0;
  
  console.log('事件循环阶段测试开始');
  
  // 1. Timer 阶段 - setTimeout/setInterval
  setTimeout(() => {
    console.log(`阶段 ${++phaseCounter}: Timer 阶段 - setTimeout(1)`); // 断点 16a
  }, 1);
  
  setTimeout(() => {
    console.log(`阶段 ${++phaseCounter}: Timer 阶段 - setTimeout(0)`); // 断点 16b
  }, 0);
  
  // 2. Pending callbacks 阶段 - 通过 TCP 错误模拟
  const net = require('net');
  const errorSocket = new net.Socket();
  errorSocket.on('error', (err) => {
    console.log(`阶段 ${++phaseCounter}: Pending callbacks 阶段 - ${err.code}`); // 断点 16c
  });
  // 尝试连接到不存在的地址触发错误
  errorSocket.connect(80, 'nonexistent.invalid.domain');
  
  // 3. Poll 阶段 - I/O 操作
  require('fs').stat(__filename, (err, stats) => {
    if (!err) {
      console.log(`阶段 ${++phaseCounter}: Poll 阶段 - 文件状态检查`); // 断点 16d
    }
  });
  
  // 4. Check 阶段 - setImmediate
  setImmediate(() => {
    console.log(`阶段 ${++phaseCounter}: Check 阶段 - setImmediate`); // 断点 16e
  });
  
  // 5. Close callbacks 阶段
  const closeSocket = new net.Socket();
  closeSocket.on('close', () => {
    console.log(`阶段 ${++phaseCounter}: Close callbacks 阶段`); // 断点 16f
  });
  process.nextTick(() => {
    closeSocket.destroy();
  });
  
  // 微任务始终在阶段之间执行
  process.nextTick(() => {
    console.log('微任务: nextTick 在阶段之间执行'); // 断点 16g
  });
  
  Promise.resolve().then(() => {
    console.log('微任务: Promise 在阶段之间执行'); // 断点 16h
  });
}

// 验证 I/O 操作的执行时机
function testIOOperations() {
  logPhase('I/O Test', '验证 I/O 操作执行时机');
  
  const fs = require('fs');
  
  // 异步文件读取
  fs.readFile(__filename, 'utf8', (err, data) => {
    if (err) {
      console.error('文件读取错误:', err);
      return;
    }
    console.log('I/O 回调: 文件读取完成'); // 断点 17
    
    // 在 I/O 回调中添加其他任务
    process.nextTick(() => {
      console.log('I/O 回调中的 nextTick'); // 断点 18
    });
    
    setImmediate(() => {
      console.log('I/O 回调中的 setImmediate'); // 断点 19
    });
  });
}

// 内存和性能监控
function monitorPerformance() {
  logPhase('Performance Monitor', '监控事件循环性能');
  
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  // 事件循环延迟测试
  setImmediate(() => {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    console.log('性能指标:'); // 断点 20
    console.log(`- 执行时间: ${Number(endTime - startTime) / 1000000}ms`);
    console.log(`- 内存变化: ${(endMemory.heapUsed - startMemory.heapUsed) / 1024}KB`);
    console.log(`- 事件循环延迟: ${process.hrtime.bigint() - endTime}ns`);
  });
}

// 主测试函数
function runEventLoopDebugTests() {
  console.log('开始 Node.js 事件循环调试测试');
  console.log('请在标记的断点处设置断点进行调试');
  console.log('========================================\n');
  
  // 按顺序执行测试
  testNextTick();
  
  setTimeout(() => {
    testTimeoutVsImmediate();
  }, 100);
  
  setTimeout(() => {
    testTimerPrecision();
  }, 200);
  
  setTimeout(() => {
    testMixedTasks();
  }, 300);
  
  setTimeout(() => {
    testNextTickStarvation();
  }, 400);
  
  setTimeout(() => {
    testEventEmitterTiming();
  }, 500);
  
  setTimeout(() => {
    testAsyncConsistency();
  }, 600);
  
  setTimeout(() => {
    testIOOperations();
  }, 700);
  
  setTimeout(() => {
    testEventLoopPhasesDetailed();
  }, 800);
  
  setTimeout(() => {
    monitorPerformance();
  }, 900);
  
  // 结束标记
  setTimeout(() => {
    console.log('\n========================================');
    console.log('事件循环调试测试完成');
    console.log('\n测试总结:');
    console.log('✅ process.nextTick 优先级验证');
    console.log('✅ setTimeout vs setImmediate 行为差异');
    console.log('✅ 定时器精度和长时间回调影响');
    console.log('✅ 微任务和宏任务混合执行');
    console.log('✅ process.nextTick 饿死 I/O 演示');
    console.log('✅ EventEmitter 构造函数事件发射');
    console.log('✅ 异步 API 一致性设计');
    console.log('✅ I/O 操作执行时机');
    console.log('✅ 事件循环各阶段详细行为');
    console.log('✅ 性能监控和度量');
    process.exit(0);
  }, 1200);
}

// 错误处理 - 改进错误处理逻辑
process.on('uncaughtException', (err) => {
  // 过滤掉预期的网络连接错误
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ENOTFOUND' || 
      err.code === 'ECONNREFUSED' || err.code === 'ERR_SOCKET_BAD_PORT') {
    console.log('网络连接错误 (已处理):', err.code);
    return;
  }
  
  console.error('未捕获的异常:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  console.error('Promise:', promise);
});

// 启动调试测试
if (require.main === module) {
  runEventLoopDebugTests();
}

module.exports = {
  testNextTick,
  testTimeoutVsImmediate,
  testTimerPrecision,
  testMixedTasks,
  testNextTickStarvation,
  testEventEmitterTiming,
  testAsyncConsistency,
  testIOOperations,
  testEventLoopPhasesDetailed,
  monitorPerformance,
  runEventLoopDebugTests
};
