/**
 * @linkcode/schema —— 唯一数据契约（PLAN §2.1 / §4.3）。
 * 所有跨进程、跨端、以及 host 抽象层之后的业务消息类型都来自这里。
 * 其它包不得重复定义消息类型，只能从此处 import 或用 z.infer 推导。
 */
export * from './common';
export * from './agent';
export * from './wire';
