export const ERROR_MESSAGES = {
	GROUP_ONLY: "❌ This command only works in groups.",
	NO_THREAD_ID:
		"❌ Unable to determine thread ID.\nThis command should be used in a thread topic.",
	NO_GROUP_BINDING:
		"❌ No feed bound to this group.\nUse /bindfeed first to bind a feed.",
	NO_COOKIE:
		"❌ No authentication cookie set for this group.\nUse /setcookie first to set your XDNMB credentials.",
	GENERIC_ERROR: "❌ An error occurred. Please try again.",
} as const;
