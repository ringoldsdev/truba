import { Readable, ReadableOptions, Writable } from "stream";
import readline from "readline";

// TODO: manage stream backpressure
// TODO: add proper documentation using tsdoc
// TODO: set up CICD and deploy to npm - CICD should test for all major node versions

// TODO: add support for multiple sources (array of generator, string, array, promise, etc)
// TODO: make it possible to name all sources and names will get passed down along with data
// TODO: add support for multiple destinations
// TODO: make it possible to name all destinations and route data based on name

type Result<T> = T | Promise<T>;
type Unarray<T> = T extends Array<infer U> ? U : T;

async function* arrayGenerator<T>(source: T[]) {
  for (const item of source) {
    yield item;
  }
}

async function* promiseGenerator<T>(source: Promise<T>) {
  yield await source;
}

async function* streamGenerator(source: Readable) {
  for await (const chunk of source) {
    yield (chunk as Buffer).toString();
  }
}

function generatorStream<T>(
  source: AsyncGenerator<T>,
  readableOptions: ReadableOptions = {}
) {
  const processValue = readableOptions.objectMode
    ? <T>(value: T) => value
    : <T>(value: T) => JSON.stringify(value);

  return new Readable({
    objectMode: false,
    read: async function () {
      const { value, done } = await source.next();
      if (done) {
        this.push(null);
        return;
      }
      this.push(processValue(value));
    },
    ...readableOptions
  });
}

async function pipe<T>(source: AsyncGenerator<T>, destination: Writable) {
  for await (const item of source) {
    destination.write(item);
  }

  destination.end();
}

function streamLineReader(source: Readable, skipEmptyLines = false) {
  const passthrough = new Readable({ objectMode: true, read: () => {} });

  const rl = readline.createInterface({
    input: source,
    crlfDelay: Infinity
  });

  if (skipEmptyLines) {
    rl.on("line", (line) => {
      if (line.length > 0) {
        passthrough.push(line);
      }
    });
  } else {
    rl.on("line", (line) => {
      passthrough.push(line);
    });
  }

  rl.on("close", () => {
    passthrough.push(null);
  });

  return streamGenerator(passthrough);
}

async function* flat<T>(source: AsyncGenerator<T>) {
  for await (const item of source) {
    if (!Array.isArray(item)) {
      yield item;
      continue;
    }
    for (const subItem of item) {
      yield subItem;
    }
  }
}

async function* chunk<T>(source: AsyncGenerator<T>, size: number) {
  let buffer: T[] = [];
  for await (const item of source) {
    buffer.push(item);
    if (buffer.length === size) {
      yield buffer;
      buffer = [];
    }
  }
  if (buffer.length) {
    yield buffer;
  }
}

async function* map<T, U>(
  source: Generator<T> | AsyncGenerator<T>,
  fn: (val: T) => Result<U>
) {
  for await (const item of source) {
    yield fn(item);
  }
}

async function* filter<T>(
  source: Generator<T> | AsyncGenerator<T>,
  fn: (val: T) => Result<boolean>
) {
  for await (const item of source) {
    if (await fn(item)) {
      yield item;
    }
  }
}

async function result<T>(source: AsyncGenerator<T>) {
  const res: T[] = [];
  for await (const item of source) {
    res.push(item);
  }
  return res;
}

async function each<T, U>(
  source: AsyncGenerator<T>,
  fn: (val: T) => Result<U>
) {
  for await (const item of source) {
    await fn(item);
  }
}

async function* reduce<T>(
  source: AsyncGenerator<T>,
  key: string | number | symbol,
  ignoreUndefined = false
) {
  const acc: Record<string, T[]> = {};
  for await (const item of source) {
    const value = item[key];
    if (ignoreUndefined && value === undefined) {
      continue;
    }
    if (!(value in acc)) {
      acc[value] = [item];
      continue;
    }
    acc[value].push(item);
  }
  yield acc;
}

async function* tap<T, U>(
  source: AsyncGenerator<T>,
  fn: (val: T) => Result<U>
) {
  for await (const item of source) {
    await fn(item);
    yield item;
  }
}

async function* collect<T>(source: AsyncGenerator<T>) {
  const res: T[] = [];
  for await (const item of source) {
    res.push(item);
  }
  yield res;
}

async function* take<T>(source: AsyncGenerator<T>, count: number) {
  const res: T[] = [];
  for await (const item of source) {
    res.push(item);
    if (res.length === count) {
      break;
    }
  }
  yield* res;
}

async function* unique<T>(source: AsyncGenerator<T>) {
  const res = new Set<T>();
  for await (const item of source) {
    if (!res.has(item)) {
      res.add(item);
      yield item;
    }
  }
}

type ReduceOptions = {
  ignoreUndefined?: boolean;
};

export type Pipeline<T> = {
  map: <U>(fn: (val: T) => Result<U>) => Pipeline<U>;
  filter: (fn: (val: T) => Result<boolean>) => Pipeline<T>;
  take: (count: number) => Pipeline<T>;
  chunk: (size: number) => Pipeline<T[]>;
  flat: () => Pipeline<Unarray<T>>;
  flatMap: <U>(fn: (val: T) => Result<U[]>) => Pipeline<U>;
  collect: () => Pipeline<T[]>;
  apply: <U>(fn: (source: Pipeline<T>) => U) => U;
  result: () => Result<T[]>;
  each: <U>(fn: (val: T) => Result<U>) => Result<void>;
  tap: <U>(fn: (val: T) => Result<U>) => Pipeline<T>;
  unique: () => Pipeline<T>;
  toGenerator: () => AsyncGenerator<T>;
  toStream: (readableOptions?: ReadableOptions) => Readable;
  pipe: (destination: Writable) => Promise<void>;
  reduce: (
    key: string | number | symbol,
    options?: ReduceOptions
  ) => Pipeline<Record<string, T[]>>;
};

const pipelineBase = <T>(source: AsyncGenerator<T>): Pipeline<T> => {
  return {
    map: <U>(fn: (val: T) => Result<U>) => pipelineBase(map(source, fn)),
    filter: (fn: (val: T) => Result<boolean>) =>
      pipelineBase(filter(source, fn)),
    chunk: (size: number) => pipelineBase(chunk(source, size)),
    take: (count: number) => pipelineBase(take(source, count)),
    flat: () => pipelineBase(flat(source)),
    flatMap: <U>(fn: (val: T) => Result<U[]>) =>
      pipelineBase(flat(map(source, fn))),
    collect: () => pipelineBase(collect(source)),
    apply: <U>(fn: (pipeline: Pipeline<T>) => U) => fn(pipelineBase(source)),
    result: () => result(source),
    each: <U>(fn: (val: T) => Result<U>) => each(source, fn),
    tap: <U>(fn: (val: T) => Result<U>) => pipelineBase(tap(source, fn)),
    toGenerator: () => source,
    toStream: (readableOptions: ReadableOptions = {}) =>
      generatorStream(source, readableOptions),
    pipe: (destination: Writable) => pipe(source, destination),
    unique: () => pipelineBase(unique(source)),
    reduce: (key: string | number | symbol, options?: ReduceOptions) =>
      pipelineBase(reduce(source, key, options?.ignoreUndefined))
  };
};

type FromStreamLineReaderOptions = {
  skipEmptyLines?: boolean;
};

export const laygo = {
  from: <T>(source: T) => pipelineBase(arrayGenerator([source])),
  fromArray: <T>(source: T[]) => pipelineBase(arrayGenerator(source)),
  fromGenerator: <T>(source: AsyncGenerator<T>) => pipelineBase(source),
  fromPromise: <T>(source: Promise<T>) =>
    pipelineBase(promiseGenerator(source)),
  fromReadableStream: (source: Readable) =>
    pipelineBase<string>(streamGenerator(source)),
  fromStreamLineReader: (
    source: Readable,
    options?: FromStreamLineReaderOptions
  ) => pipelineBase<string>(streamLineReader(source, options?.skipEmptyLines)),
  fromPipeline: <T>(source: Pipeline<T>) => pipelineBase(source.toGenerator())
};

export const Helpers = {
  split:
    (separator: string | RegExp = "") =>
    (pipeline: Pipeline<string>) =>
      pipeline.flatMap((val) => val.split(separator)),
  join:
    (separator: string = "") =>
    (pipeline: Pipeline<string>) =>
      pipeline.collect().map((val) => val.join(separator)),
  trim: (pipeline: Pipeline<string>) => pipeline.map((val) => val.trim()),
  replace:
    (searchValue: string | RegExp, replaceValue: string) =>
    (pipeline: Pipeline<string>) =>
      pipeline.map((val) => val.replace(searchValue, replaceValue)),
  parseJson: (pipeline: Pipeline<string>) =>
    pipeline.map((val) => JSON.parse(val)),
  stringifyJson: <T>(pipeline: Pipeline<T>) =>
    pipeline.map((val) => JSON.stringify(val))
};

export type Laygo = typeof laygo;
