export interface ForumInfo {
	id: string;
	fgroup: string;
	sort: string;
	name: string;
	showName: string;
	msg: string;
	interval: string;
	safe_mode: string;
	auto_delete: string;
	thread_count: string;
	permission_level: string;
	forum_fuse_id: string;
	createdAt: string;
	updateAt: string;
	status: string;
}

export interface ForumGroup {
	id: string;
	sort: string;
	name: string;
	status: string;
	forums: ForumInfo[];
}

export interface Reply {
	id: number;
	fid?: number;
	ReplyCount?: number;
	img: string;
	ext: string;
	now: string;
	user_hash: string;
	name: string;
	title: string;
	content: string;
	sage: number;
	admin: number;
	Hide?: number;
}

export interface Thread {
	id: number;
	fid: number;
	ReplyCount: number;
	img: string;
	ext: string;
	now: string;
	user_hash: string;
	name: string;
	title: string;
	content: string;
	sage: number;
	admin: number;
	Hide: number;
	Replies?: Reply[];
	RemainReplies?: number;
}

export interface ThreadData extends Thread {
	Replies: Reply[];
}

export interface FeedThread {
	id: string;
	fid: string;
	img: string;
	ext: string;
	now: string;
	user_hash: string;
	name: string;
	email: string;
	title: string;
	content: string;
	admin: string;
}

export interface CDNInfo {
	url: string;
	rate: number;
}

export interface TimelineInfo {
	id: number;
	name: string;
	display_name: string;
	notice: string;
	max_page: number;
}
