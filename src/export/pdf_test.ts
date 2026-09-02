import { convertMarkdownToPdf } from "./pdf.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("PDF conversion sets the Typst project root", async () => {
	const directory = await Deno.makeTempDir();
	const pandocPath = `${directory}/pandoc`;
	const argumentsPath = `${directory}/arguments.txt`;
	const originalPath = Deno.env.get("PATH");

	try {
		await Deno.writeTextFile(
			pandocPath,
			`#!/bin/sh
printf '%s\\n' "$@" > "$PANDOC_ARGUMENTS_PATH"
cat >/dev/null
printf 'pdf'
`,
		);
		await Deno.chmod(pandocPath, 0o755);
		Deno.env.set("PATH", `${directory}:${originalPath ?? ""}`);
		Deno.env.set("PANDOC_ARGUMENTS_PATH", argumentsPath);

		const pdf = await convertMarkdownToPdf("![image](/app/data/image.png)");
		assert(
			new TextDecoder().decode(pdf ?? new Uint8Array()) === "pdf",
			"PDF output differs",
		);

		const argumentsText = await Deno.readTextFile(argumentsPath);
		assert(
			argumentsText.split("\n").includes("--pdf-engine-opt=--root=/"),
			"Typst root option was not passed through Pandoc",
		);
	} finally {
		if (originalPath === undefined) Deno.env.delete("PATH");
		else Deno.env.set("PATH", originalPath);
		Deno.env.delete("PANDOC_ARGUMENTS_PATH");
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});
