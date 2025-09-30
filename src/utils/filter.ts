export function isSpamContent(content: string): boolean {
  const spamPatterns = [
    "催更",
    "F5",
    "gkd",
    "把po给我挖出来",
    "魂兮归来",
    "求你了再写",
  ];

    return spamPatterns.some((pattern) => content.includes(pattern)) || content.length < 2;
}
