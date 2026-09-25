declare module 'node-pty' {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }

  export interface IDisposable {
    dispose(): void;
  }

  export interface IPty {
    readonly pid: number;
    readonly cols: number;
    readonly rows: number;
    readonly process: string;
    onData: (listener: (data: string) => void) => IDisposable;
    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => IDisposable;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
  }

  export function spawn(
    file: string,
    args: string[] | string,
    options: IPtyForkOptions
  ): IPty;
}
