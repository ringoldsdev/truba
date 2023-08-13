import { ReadableOptions } from "stream";
import { ForkableGenerator, createForkableGenerator } from "./fork";
import { PipeDestination, Pipeline, Result } from "./types";
import { ErrorMap } from "./errors";
import { pipe, pipeFirst, toStream, each } from "./consumers";
import {
  chunk,
  collect,
  filter,
  flat,
  join,
  map,
  reduce,
  result,
  split,
  take,
  tap,
  unique,
  validate
} from "./transformers";

export function pipeline<T>(source: AsyncGenerator<T>): Pipeline<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let generator: AsyncGenerator<any> = source;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let forkedGenerator: ForkableGenerator<any>;

  return {
    split(this: Pipeline<string>, separator: string | RegExp, limit?: number) {
      generator = split(generator, separator, limit);
      return this;
    },
    join(this: Pipeline<string>, delimiter?: string) {
      generator = join(generator, delimiter);
      return this;
    },
    map<U>(fn: (val: T) => Result<U>, errorMap?: ErrorMap<T, U>) {
      generator = map(generator, fn, errorMap);
      return this;
    },
    filter(fn: (val: T) => Result<boolean>, errorMap?: ErrorMap<T, T>) {
      generator = filter(generator, fn, errorMap);
      return this;
    },
    chunk(size: number) {
      generator = chunk(generator, size);
      return this;
    },
    take(count: number) {
      generator = take(generator, count);
      return this;
    },
    flat() {
      generator = flat(generator);
      return this;
    },
    flatMap<U>(fn: (val: T) => Result<U[]>) {
      generator = flat(map(generator, fn));
      return this;
    },
    collect() {
      generator = collect(generator);
      return this;
    },
    apply<U>(fn: (src: Pipeline<T>) => U) {
      return fn(this);
    },
    result() {
      return result(generator);
    },
    each<U>(fn: (val: T) => Result<U>, errorMap?: ErrorMap<T, U>) {
      return each(generator, fn, errorMap);
    },
    tap<U>(fn: (val: T) => Result<U>, errorMap?: ErrorMap<T, U>) {
      generator = tap(generator, fn, errorMap);
      return this;
    },
    toGenerator() {
      return generator;
    },
    toStream: (readableOptions: ReadableOptions = {}) =>
      toStream(generator, readableOptions),
    pipe(...destinations: PipeDestination<T>[]) {
      return pipe(generator, destinations);
    },
    pipeFirst(...destinations: PipeDestination<T>[]) {
      return pipeFirst(generator, ...destinations);
    },
    unique() {
      generator = unique(generator);
      return this;
    },
    reduce<U>(
      fn: (acc: U, val: T) => Result<U>,
      initialValue: U,
      errorMap?: ErrorMap<T, U>
    ) {
      generator = reduce(generator, fn, initialValue, errorMap);
      return this;
    },
    groupBy<U>(
      this: Pipeline<T extends Record<string | number | symbol, U> ? T : never>,
      key: keyof T
    ) {
      generator = reduce(
        generator,
        (acc, val) => {
          const k = val[key];
          if (!acc[k]) {
            acc[k] = [];
          }
          acc[k].push(val);
          return acc;
        },
        {}
      );
      return this;
    },
    fork() {
      if (!forkedGenerator) {
        forkedGenerator = createForkableGenerator(generator);
      }
      return pipeline(forkedGenerator.fork());
    },
    validate(
      fn: (data: T) => Result<boolean>,
      errFn: (data: T) => Result<void>
    ) {
      generator = validate(generator, fn, errFn);
      return this;
    }
  };
}