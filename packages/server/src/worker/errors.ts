export class TimeoutError extends Error {
  constructor(message = "Task timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
