const emotList = [
	"･ﾟ( ﾉヮ´ )",
	"(ﾉ)`ω´(ヾ)",
	"ᕕ( ᐛ )ᕗ",
	"(　ˇωˇ)",
	"( ｣ﾟДﾟ)｣＜",
	"( ›´ω`‹ )",
	"(;´ヮ`)7",
	"(`ゥ´ )",
	"(`ᝫ´ )",
	"( ᑭ`д´)ᓀ))д´)ᑫ",
	"σ( ᑒ )",
];
const richEmotList: Record<string, string> = {
	齐齐蛤尔: "(`ヮ´ )σ`∀´) ﾟ∀ﾟ)σ",
	大嘘:
		`吁~~~~　　rnm，退钱！\n` + ` 　　　/　　　/ \n` + "(　ﾟ 3ﾟ) `ー´) `д´) `д´)",
	防剧透: "[h] [/h]",
	骰子: "[n]",
	高级骰子: "[n,m]",
};

export function isSpamContent(content: string): boolean {
	const spamPatterns = [
		"催更",
		"F5",
		"gkd",
		"把po给我挖出来",
		"魂兮归来",
		"求你了再写",
	];
    // Check for emoticons
    for (const emot of emotList) {
        if (content.includes(emot)) {
            return true;
        }
    }
    // Check for rich emoticons
    for (const key in richEmotList) {
        if (content.includes(key) || content.includes(richEmotList[key])) {
            return true;
        }
    }
    // Check for spam patterns and short content
    for (const pattern of spamPatterns) {
        if (content.includes(pattern)) {
            return true;
        }
    }
    if (content.length < 2) {
        return true;
    }
    return false;
}
