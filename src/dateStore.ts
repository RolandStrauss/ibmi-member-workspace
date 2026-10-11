import { BaselineFiles, baselineFileName } from "./baselineStore";
import { errorMessage } from "./errors";

/**
 * The source dates of each checkout's baseline text: one SRCDAT per line, as `YYMMDD` ("0" for
 * none), read from the IBM i when the text is downloaded. Files are content-addressed like the
 * baselines (`dates/<sha256 of the text>`), so they are pruned with them and shared across work
 * items. Kept free of the `vscode` module so it can be unit tested; the files are injected.
 */

export const DATES_DIR = "dates";

const DATE = /^(0|\d{6})$/;
const TEMP_SUFFIX = ".tmp";

/** Whether every value is a source date as kept here. */
export function validSourceDates(dates: readonly string[]): boolean {
  return dates.every((date) => DATE.test(date));
}

export class DateStore {
  /** Without `files` (no workspace storage) nothing is kept. */
  constructor(
    private readonly files: BaselineFiles | undefined,
    private readonly log: (message: string) => void
  ) {}

  /** The dates kept for the text hashing to `hash`, or undefined when none are (or the file is damaged). */
  async read(hash: string): Promise<string[] | undefined> {
    if (!this.files) {
      return undefined;
    }
    let text: string;
    try {
      text = Buffer.from(await this.files.read(baselineFileName(hash))).toString("utf-8");
    } catch {
      return undefined;
    }
    const dates = text === "" ? [] : text.split("\n");
    if (!validSourceDates(dates)) {
      this.log(`[dates] The source dates of ${hash.substring(0, 12)} are damaged and are ignored`);
      return undefined;
    }
    return dates;
  }

  async has(hash: string): Promise<boolean> {
    try {
      return this.files !== undefined && await this.files.exists(baselineFileName(hash));
    } catch {
      return false;
    }
  }

  /** Keeps `dates` for `hash`, atomically. A failure is logged, never thrown. Returns whether they are kept. */
  async write(hash: string, dates: readonly string[]): Promise<boolean> {
    if (!this.files) {
      return false;
    }
    try {
      const name = baselineFileName(hash);
      if (!validSourceDates(dates)) {
        throw new Error("not source dates");
      }
      const temp = name + TEMP_SUFFIX;
      await this.files.write(temp, Buffer.from(dates.join("\n"), "utf-8"));
      await this.files.rename(temp, name);
      return true;
    } catch (err) {
      this.log(`[dates] Could not keep the source dates of ${hash.substring(0, 12)}: ${errorMessage(err)}`);
      return false;
    }
  }

  /** Deletes the dates of texts not in `keep`. */
  async prune(keep: ReadonlySet<string>): Promise<number> {
    if (!this.files) {
      return 0;
    }
    let deleted = 0;
    for (const name of await this.files.list()) {
      if (name.endsWith(TEMP_SUFFIX) || keep.has(name)) {
        continue;
      }
      try {
        await this.files.delete(name);
        deleted++;
      } catch (err) {
        this.log(`[dates] Could not delete ${name}: ${errorMessage(err)}`);
      }
    }
    return deleted;
  }
}
