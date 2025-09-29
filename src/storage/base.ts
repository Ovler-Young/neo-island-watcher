import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export class BaseStorage<T> {
	private readonly filePath: string;
	private readonly dataDir: string;

	constructor(fileName: string, subDir = "") {
		this.dataDir = join("data", subDir);
		this.filePath = join(this.dataDir, fileName);
	}

	async ensureDataDir(): Promise<void> {
		await ensureDir(this.dataDir);
	}

	async read(): Promise<T> {
		await this.ensureDataDir();

		try {
			const data = await Deno.readTextFile(this.filePath);
			return JSON.parse(data) as T;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return {} as T;
			}
			throw error;
		}
	}

	async write(data: T): Promise<void> {
		await this.ensureDataDir();

		const tempFile = `${this.filePath}.tmp`;
		const jsonData = JSON.stringify(data, null, 2);

		await Deno.writeTextFile(tempFile, jsonData);

		try {
			await Deno.rename(tempFile, this.filePath);
		} catch {
			await Deno.remove(tempFile).catch(() => {});
			throw new Error("Failed to write data atomically");
		}
	}

	async update(updater: (data: T) => T | Promise<T>): Promise<void> {
		const data = await this.read();
		const updatedData = await updater(data);
		await this.write(updatedData);
	}
}
