import { type Node, parse, Telegraph } from "@dcdunkan/telegraph";

// Re-export Node type
export type { Node };

/**
 * Calculate the byte size of content when serialized
 */
function calculateByteSize(content: Node[]): number {
	return new TextEncoder().encode(JSON.stringify(content)).length;
}

/**
 * Split Telegraph nodes into pages under 30KB each
 */
function splitContentIntoPages(
	nodes: Node[],
	maxSize: number = 30 * 1024,
): Node[][] {
	const pages: Node[][] = [];
	let currentPage: Node[] = [];
	let currentSize = 0;

	for (const node of nodes) {
		const nodeSize = calculateByteSize([node]);

		// If adding this node would exceed the limit, start a new page
		if (currentSize + nodeSize > maxSize && currentPage.length > 0) {
			pages.push(currentPage);
			currentPage = [node];
			currentSize = nodeSize;
		} else {
			currentPage.push(node);
			currentSize += nodeSize;
		}
	}

	// Add the last page if it has content
	if (currentPage.length > 0) {
		pages.push(currentPage);
	}

	// Ensure at least one page exists
	return pages.length > 0 ? pages : [[]];
}

/**
 * Create navigation node with prev/next links
 */
function createNavigationNode(prevUrl?: string, nextUrl?: string): Node | null {
	const links: Node[] = [];

	if (prevUrl) {
		links.push({
			tag: "a",
			attrs: { href: prevUrl },
			children: ["上一页 "],
		});
	}

	if (nextUrl) {
		links.push({
			tag: "a",
			attrs: { href: nextUrl },
			children: ["下一页 "],
		});
	}

	if (links.length === 0) {
		return null;
	}

	return {
		tag: "p",
		children: links,
	};
}

/**
 * Create all Telegraph pages with navigation links
 */
async function createPagesWithNavigation(
	telegraph: Telegraph,
	pages: Node[][],
	baseTitle: string,
	authorName: string,
): Promise<string[]> {
	const pageUrls: string[] = [];
	const totalPages = pages.length;

	// First pass: Create all pages without navigation
	console.log(`Creating ${totalPages} Telegraph page(s)...`);

	for (let i = 0; i < totalPages; i++) {
		const pageNumber = i + 1;
		const title =
			totalPages > 1 ? `${baseTitle} (${pageNumber}/${totalPages})` : baseTitle;

		try {
			const page = await telegraph.create({
				title,
				author_name: authorName,
				content: pages[i],
			});

			pageUrls.push(page.url);
			console.log(`Created page ${pageNumber}/${totalPages}: ${page.url}`);

			// Add delay to avoid rate limiting
			if (i < totalPages - 1) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		} catch (error) {
			console.error(`Error creating page ${pageNumber}:`, error);

			// Check for FLOOD_WAIT error
			if (error instanceof Error && error.message.includes("FLOOD_WAIT")) {
				const match = error.message.match(/FLOOD_WAIT_(\d+)/);
				if (match) {
					const waitTime = parseInt(match[1], 10);
					console.log(`Rate limited, waiting ${waitTime} seconds...`);
					await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));

					// Retry this page
					i--;
					continue;
				}
			}

			throw error;
		}
	}

	// Second pass: Update pages with navigation links (if multiple pages)
	if (totalPages > 1) {
		console.log("Adding navigation links to pages...");

		for (let i = 0; i < totalPages; i++) {
			const prevUrl = i > 0 ? pageUrls[i - 1] : undefined;
			const nextUrl = i < totalPages - 1 ? pageUrls[i + 1] : undefined;
			const navNode = createNavigationNode(prevUrl, nextUrl);

			if (navNode) {
				const updatedContent = [navNode, ...pages[i], navNode];

				const pageNumber = i + 1;
				const title = `${baseTitle} (${pageNumber}/${totalPages})`;

				// Extract path from URL for editing
				const path = pageUrls[i].split("/").pop();
				if (!path) {
					console.error(`Invalid page URL: ${pageUrls[i]}`);
					continue;
				}

				try {
					await telegraph.edit(path, {
						title,
						author_name: authorName,
						content: updatedContent,
					});

					console.log(
						`Updated page ${pageNumber}/${totalPages} with navigation`,
					);

					// Add delay to avoid rate limiting
					if (i < totalPages - 1) {
						await new Promise((resolve) => setTimeout(resolve, 2000));
					}
				} catch (error) {
					console.error(`Error updating page ${pageNumber}:`, error);

					// Check for FLOOD_WAIT error
					if (error instanceof Error && error.message.includes("FLOOD_WAIT")) {
						const match = error.message.match(/FLOOD_WAIT_(\d+)/);
						if (match) {
							const waitTime = parseInt(match[1], 10);
							console.log(`Rate limited, waiting ${waitTime} seconds...`);
							await new Promise((resolve) =>
								setTimeout(resolve, waitTime * 1000),
							);

							// Retry this page
							i--;
							continue;
						}
					}

					// Non-fatal error, continue to next page
					console.warn(`Continuing despite error on page ${pageNumber}`);
				}
			}
		}
	}

	return pageUrls;
}

/**
 * Export markdown content to Telegraph
 * Creates disposable account and handles pagination automatically
 *
 * @param markdown - Markdown content to export
 * @param title - Page title
 * @param authorName - Author name (default: "neo-island-watcher")
 * @returns Array of Telegraph page URLs
 */
export async function exportToTelegraph(
	markdown: string,
	title: string,
	authorName: string = "neo-island-watcher",
): Promise<string[]> {
	// Create disposable Telegraph account
	const telegraph = new Telegraph();

	console.log("Creating Telegraph account...");
	const account = await telegraph.createAccount({
		short_name: authorName,
	});

	// Set the token for subsequent operations
	telegraph.token = account.access_token;
	console.log(`Telegraph account created: ${account.short_name}`);

	// Parse markdown to Telegraph nodes
	console.log("Parsing markdown to Telegraph nodes...");
	const nodes = parse(markdown, "Markdown");
	console.log(
		`Parsed ${Array.isArray(nodes) ? nodes.length : "unknown"} nodes`,
	);

	// Ensure nodes is an array
	const nodesArray = Array.isArray(nodes) ? nodes : [nodes];

	// Calculate total size
	const totalSize = calculateByteSize(nodesArray);
	console.log(`Total content size: ${(totalSize / 1024).toFixed(2)} KB`);

	// Split into pages if needed
	const pages = splitContentIntoPages(nodesArray);
	console.log(`Content split into ${pages.length} page(s)`);

	// Create pages with navigation
	const pageUrls = await createPagesWithNavigation(
		telegraph,
		pages,
		title,
		authorName,
	);

	return pageUrls;
}
