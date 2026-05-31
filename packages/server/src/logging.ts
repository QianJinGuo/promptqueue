import { type WriteStream } from "node:fs";

interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "warn";
  message: string;
  [key: string]: unknown;
}

class Logger {
  private stream: WriteStream | null = null;

  /**
   * Optionally attach a file stream for persistent logging.
   */
  setStream(stream: WriteStream): void {
    this.stream = stream;
  }

  private write(level: LogEntry["level"], message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    const line = JSON.stringify(entry) + "\n";

    // Always write to stdout/stderr
    if (level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }

    // Optionally write to attached stream
    if (this.stream) {
      try {
        this.stream.write(line);
      } catch {
        // stream may be closed — silently skip
      }
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }
}

/**
 * Singleton structured JSON logger.
 */
export const logger = new Logger();
