export const TELEGRAM_ARCHIVE_MAX_BYTES = 1_900_000_000;

export interface ZipArchive {
	path: string;
	size: number;
	entries: ZipArchiveEntry[];
}

export interface ZipArchiveEntry {
	name: string;
	sourcePath: string;
	dataOffset: number;
	size: number;
	crc32: number;
	dosDate: number;
	dosTime: number;
}

export interface ZipArchiveBatch {
	archives: ZipArchive[];
	cleanup: () => Promise<void>;
}

export interface RepartitionedZipBatch extends ZipArchiveBatch {
	omittedEntries: string[];
}

interface CentralDirectoryEntry {
	textName: string;
	name: Uint8Array;
	crc32: number;
	size: number;
	offset: number;
	dataOffset: number;
	dosDate: number;
	dosTime: number;
}

const encoder = new TextEncoder();
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const MAX_ZIP_ENTRY_COUNT = 65_535;
const CRC32_TABLE = new Uint32Array(256);

for (let value = 0; value < CRC32_TABLE.length; value++) {
	let crc = value;
	for (let bit = 0; bit < 8; bit++) {
		crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	CRC32_TABLE[value] = crc >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
	view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
	view.setUint32(offset, value, true);
}

async function writeAll(file: Deno.FsFile, data: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < data.length) {
		const written = await file.write(data.subarray(offset));
		if (written === 0) throw new Error("Unable to write ZIP data");
		offset += written;
	}
}

async function copyStoredData(
	destination: Deno.FsFile,
	entry: ZipArchiveEntry,
): Promise<void> {
	const source = await Deno.open(entry.sourcePath, { read: true });
	try {
		await source.seek(entry.dataOffset, Deno.SeekMode.Start);
		const buffer = new Uint8Array(Math.min(entry.size, 1024 * 1024));
		let remaining = entry.size;
		while (remaining > 0) {
			const read = await source.read(
				buffer.subarray(0, Math.min(buffer.length, remaining)),
			);
			if (read === null) {
				throw new Error(`Unexpected end of ZIP entry: ${entry.name}`);
			}
			await writeAll(destination, buffer.subarray(0, read));
			remaining -= read;
		}
	} finally {
		source.close();
	}
}

function calculateCrc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function getDosTimestamp(date = new Date()): {
	dosDate: number;
	dosTime: number;
} {
	const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
	return {
		dosDate:
			((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		dosTime:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			Math.floor(date.getSeconds() / 2),
	};
}

function localHeader(
	name: Uint8Array,
	crc32: number,
	size: number,
	dosDate: number,
	dosTime: number,
): Uint8Array {
	const header = new Uint8Array(30 + name.length);
	const view = new DataView(header.buffer);
	writeUint32(view, 0, 0x04034b50);
	writeUint16(view, 4, 20);
	writeUint16(view, 6, 0x0800);
	writeUint16(view, 8, 0);
	writeUint16(view, 10, dosTime);
	writeUint16(view, 12, dosDate);
	writeUint32(view, 14, crc32);
	writeUint32(view, 18, size);
	writeUint32(view, 22, size);
	writeUint16(view, 26, name.length);
	header.set(name, 30);
	return header;
}

function centralHeader(entry: CentralDirectoryEntry): Uint8Array {
	const header = new Uint8Array(46 + entry.name.length);
	const view = new DataView(header.buffer);
	writeUint32(view, 0, 0x02014b50);
	writeUint16(view, 4, 20);
	writeUint16(view, 6, 20);
	writeUint16(view, 8, 0x0800);
	writeUint16(view, 10, 0);
	writeUint16(view, 12, entry.dosTime);
	writeUint16(view, 14, entry.dosDate);
	writeUint32(view, 16, entry.crc32);
	writeUint32(view, 20, entry.size);
	writeUint32(view, 24, entry.size);
	writeUint16(view, 28, entry.name.length);
	writeUint32(view, 38, 0);
	writeUint32(view, 42, entry.offset);
	header.set(entry.name, 46);
	return header;
}

class ZipPartWriter {
	private readonly file: Deno.FsFile;
	private readonly entries: CentralDirectoryEntry[] = [];
	private bytesWritten = 0;
	private centralDirectorySize = 0;

	constructor(
		readonly path: string,
		private readonly maxBytes: number,
	) {
		this.file = Deno.openSync(path, {
			createNew: true,
			write: true,
		});
	}

	get entryCount(): number {
		return this.entries.length;
	}

	canAdd(name: Uint8Array, size: number): boolean {
		if (
			this.entries.length >= MAX_ZIP_ENTRY_COUNT ||
			name.length > 0xffff ||
			size > 0xffffffff
		) {
			return false;
		}
		const localSize = 30 + name.length + size;
		const centralSize = 46 + name.length;
		return (
			this.bytesWritten +
				localSize +
				this.centralDirectorySize +
				centralSize +
				END_OF_CENTRAL_DIRECTORY_SIZE <=
			this.maxBytes
		);
	}

	async add(
		name: string,
		encodedName: Uint8Array,
		data: Uint8Array,
	): Promise<void> {
		const crc32 = calculateCrc32(data);
		const { dosDate, dosTime } = getDosTimestamp();
		const header = localHeader(
			encodedName,
			crc32,
			data.length,
			dosDate,
			dosTime,
		);
		const offset = this.bytesWritten;
		await writeAll(this.file, header);
		await writeAll(this.file, data);
		this.bytesWritten += header.length + data.length;
		this.centralDirectorySize += 46 + encodedName.length;
		this.entries.push({
			textName: name,
			name: encodedName,
			crc32,
			size: data.length,
			offset,
			dataOffset: offset + header.length,
			dosDate,
			dosTime,
		});
	}

	async addStored(entry: ZipArchiveEntry, name: Uint8Array): Promise<void> {
		const header = localHeader(
			name,
			entry.crc32,
			entry.size,
			entry.dosDate,
			entry.dosTime,
		);
		const offset = this.bytesWritten;
		await writeAll(this.file, header);
		await copyStoredData(this.file, entry);
		this.bytesWritten += header.length + entry.size;
		this.centralDirectorySize += 46 + name.length;
		this.entries.push({
			textName: entry.name,
			name,
			crc32: entry.crc32,
			size: entry.size,
			offset,
			dataOffset: offset + header.length,
			dosDate: entry.dosDate,
			dosTime: entry.dosTime,
		});
	}

	async finish(): Promise<ZipArchive> {
		const centralDirectoryOffset = this.bytesWritten;
		for (const entry of this.entries) {
			await writeAll(this.file, centralHeader(entry));
		}

		const end = new Uint8Array(END_OF_CENTRAL_DIRECTORY_SIZE);
		const view = new DataView(end.buffer);
		writeUint32(view, 0, 0x06054b50);
		writeUint16(view, 8, this.entries.length);
		writeUint16(view, 10, this.entries.length);
		writeUint32(view, 12, this.centralDirectorySize);
		writeUint32(view, 16, centralDirectoryOffset);
		await writeAll(this.file, end);
		this.file.close();

		const size = (await Deno.stat(this.path)).size;
		if (size > this.maxBytes) {
			throw new Error(`Finalized ZIP exceeds ${this.maxBytes} bytes`);
		}
		return {
			path: this.path,
			size,
			entries: this.entries.map((entry) => ({
				name: entry.textName,
				sourcePath: this.path,
				dataOffset: entry.dataOffset,
				size: entry.size,
				crc32: entry.crc32,
				dosDate: entry.dosDate,
				dosTime: entry.dosTime,
			})),
		};
	}

	close(): void {
		try {
			this.file.close();
		} catch {
			// The file may already be finalized.
		}
	}
}

export class SplitZipWriter {
	private current: ZipPartWriter | null = null;
	private readonly archives: ZipArchive[] = [];
	private readonly paths: string[] = [];
	private readonly entryNames = new Set<string>();

	constructor(
		private readonly directory: string,
		private readonly maxBytes = TELEGRAM_ARCHIVE_MAX_BYTES,
	) {
		if (maxBytes <= END_OF_CENTRAL_DIRECTORY_SIZE) {
			throw new Error("ZIP size limit is too small");
		}
	}

	async add(name: string, data: Uint8Array): Promise<boolean> {
		if (this.entryNames.has(name)) {
			throw new Error(`Duplicate ZIP entry: ${name}`);
		}
		const encodedName = encoder.encode(name);

		if (!this.current) {
			await this.openPart();
		}
		if (!this.current?.canAdd(encodedName, data.length)) {
			if (this.current && this.current.entryCount > 0) {
				this.archives.push(await this.current.finish());
				this.current = null;
				await this.openPart();
			}
			if (!this.current?.canAdd(encodedName, data.length)) {
				return false;
			}
		}

		const current = this.current;
		if (!current) throw new Error("ZIP part was not initialized");
		await current.add(name, encodedName, data);
		this.entryNames.add(name);
		return true;
	}

	async addStored(entry: ZipArchiveEntry): Promise<boolean> {
		if (this.entryNames.has(entry.name)) {
			throw new Error(`Duplicate ZIP entry: ${entry.name}`);
		}
		const encodedName = encoder.encode(entry.name);

		if (!this.current) await this.openPart();
		if (!this.current?.canAdd(encodedName, entry.size)) {
			if (this.current && this.current.entryCount > 0) {
				this.archives.push(await this.current.finish());
				this.current = null;
				await this.openPart();
			}
			if (!this.current?.canAdd(encodedName, entry.size)) return false;
		}

		const current = this.current;
		if (!current) throw new Error("ZIP part was not initialized");
		await current.addStored(entry, encodedName);
		this.entryNames.add(entry.name);
		return true;
	}

	async finish(): Promise<ZipArchive[]> {
		if (this.current && this.current.entryCount > 0) {
			this.archives.push(await this.current.finish());
			this.current = null;
		}
		return [...this.archives];
	}

	async cleanup(): Promise<void> {
		this.current?.close();
		this.current = null;
		await Promise.all(
			this.paths.map((path) => Deno.remove(path).catch(() => {})),
		);
	}

	private async openPart(): Promise<void> {
		await Deno.mkdir(this.directory, { recursive: true });
		const path = `${this.directory}/thread-export-${crypto.randomUUID()}.zip`;
		this.paths.push(path);
		this.current = new ZipPartWriter(path, this.maxBytes);
	}
}

export async function repartitionZipArchives(
	archives: ZipArchive[],
	directory: string,
	maxBytes: number,
): Promise<RepartitionedZipBatch> {
	const writer = new SplitZipWriter(directory, maxBytes);
	const omittedEntries: string[] = [];
	try {
		for (const archive of archives) {
			for (const entry of archive.entries) {
				if (!(await writer.addStored(entry))) omittedEntries.push(entry.name);
			}
		}
		return {
			archives: await writer.finish(),
			omittedEntries,
			cleanup: () => writer.cleanup(),
		};
	} catch (error) {
		await writer.cleanup();
		throw error;
	}
}
