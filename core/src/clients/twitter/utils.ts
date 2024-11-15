// src/clients/twitter/utils.ts
import { Tweet } from "./base.js";  // Changed import to use our own Tweet type
import { embeddingZeroVector } from "../../core/memory.ts";
import { Content, Memory, UUID } from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { prettyConsole } from "../../index.ts";

const MAX_TWEET_LENGTH = 240;

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
        Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export const isValidTweet = (tweet: Tweet): boolean => {
    // Filter out tweets with too many hashtags, @s, or $ signs, probably spam or garbage
    const hashtagCount = (tweet.text?.match(/#/g) || []).length;
    const atCount = (tweet.text?.match(/@/g) || []).length;
    const dollarSignCount = tweet.text?.match(/\$/g) || [];
    const totalCount = hashtagCount + atCount + dollarSignCount.length;

    return (
        hashtagCount <= 1 &&
        atCount <= 2 &&
        dollarSignCount.length <= 1 &&
        totalCount <= 3
    );
};

export async function buildConversationThread(
    tweet: Tweet,
    client: ClientBase
): Promise<void> {
    const thread: Tweet[] = [];
    const visited: Set<string> = new Set();

    async function processThread(currentTweet: Tweet) { 
        if (!currentTweet) {
            prettyConsole.log("No current tweet found");
            return;
        }
        // check if the current tweet has already been saved
        const memory = await client.runtime.messageManager.getMemoryById(
            stringToUuid(currentTweet.id + "-" + client.runtime.agentId)
        );
        if (!memory) {
            prettyConsole.log("Creating memory for tweet", currentTweet.id);
            const roomId = stringToUuid(
                currentTweet.conversationId + "-" + client.runtime.agentId
            );
            const userId = stringToUuid(currentTweet.userId);

            await client.runtime.ensureConnection(
                userId,
                roomId,
                currentTweet.username,
                currentTweet.name,
                "twitter"
            );

            client.runtime.messageManager.createMemory({
                id: stringToUuid(
                    currentTweet.id + "-" + client.runtime.agentId
                ),
                agentId: client.runtime.agentId,
                content: {
                    text: currentTweet.text,
                    source: "twitter",
                    url: currentTweet.permanentUrl,
                    inReplyTo: currentTweet.inReplyToStatusId
                        ? stringToUuid(
                              currentTweet.inReplyToStatusId +
                                  "-" +
                                  client.runtime.agentId
                          )
                        : undefined,
                },
                createdAt: currentTweet.timestamp * 1000,
                roomId,
                userId:
                    currentTweet.userId === client.twitterUserId
                        ? client.runtime.agentId
                        : stringToUuid(currentTweet.userId),
                embedding: embeddingZeroVector,
            });
        }
        if (visited.has(currentTweet.id)) {
            return;
        }
        visited.add(currentTweet.id);

        thread.unshift(currentTweet);

        if(currentTweet.inReplyToStatusId) {
            try {
            //const result = await client.twitterClient.v2.get(`tweets/${currentTweet.inReplyToStatusId}`);
            const result = await client.twitterClient.v2.singleTweet(currentTweet.inReplyToStatusId);
            if (result.data) {
                const author = result.includes?.users?.find(u => u.id === result.data.author_id);
                const parentTweet: Tweet = {
                    id: result.data.id,
                    text: result.data.text,
                    conversationId: result.data.conversation_id || result.data.id,
                    createdAt: result.data.created_at || new Date().toISOString(),
                    userId: result.data.author_id || '',
                    inReplyToStatusId: result.data.in_reply_to_user_id || undefined,
                    permanentUrl: `https://twitter.com/${author?.username}/status/${result.data.id}`,
                    username: author?.username,
                    name: author?.name,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                    timestamp: result.data.created_at 
                        ? new Date(result.data.created_at).getTime() / 1000 
                        : Date.now() / 1000
                };
                await processThread(parentTweet);
            }
        } catch (error) {
                console.error("Error fetching conversation:", error);
            }
        }

        
    }

    await processThread(tweet);
}

export async function sendTweetChunks(
    client: ClientBase,
    content: Content,
    roomId: UUID,
    twitterUsername: string,
    inReplyTo: string
): Promise<Memory[]> {
    const tweetChunks = splitTweetContent(content.text);
    const sentTweets: Tweet[] = [];
    let lastTweetId = inReplyTo;

    for (const chunk of tweetChunks) {
        // Use v2 API to create tweet
        const tweetResponse = await client.requestQueue.add(async () => {
            return await client.twitterClient.v2.reply(
                chunk.replaceAll(/\\n/g, "\n").trim(),
                lastTweetId
            );
        });

        const tweetResult = await tweetResponse;
        if (!tweetResult) {
            throw new Error("Failed to create tweet");
        }

        //const getTweetResult = await client.twitterClient.v2.get(`tweets/${tweetResult.data.id}`);
        const getTweetResult = await client.twitterClient.v2.singleTweet(tweetResult.data.id);

        if (!getTweetResult) {
            throw new Error("Failed to get tweet");
        }
        

        console.log("sent tweet result:\n", getTweetResult.data.id);
        
        
        

        const finalTweet = {
            id: getTweetResult.data.id,
            text: getTweetResult.data.text,
            conversationId: getTweetResult.data.conversation_id,
            createdAt: getTweetResult.data.created_at,
            userId: getTweetResult.data.author_id,
            inReplyToStatusId: getTweetResult.data.in_reply_to_user_id,
            permanentUrl: `https://twitter.com/${twitterUsername}/status/${body.data.rest_id}`,
            hashtags: getTweetResult.data.entities?.hashtags || [],
            mentions: getTweetResult.data.entities?.mentions || [],
            photos: [],
            thread: [],
            urls: getTweetResult.data.entities?.urls.map((url) => url.url) || [],
            videos: [],
            timestamp: getTweetResult.data.created_at ? new Date(getTweetResult.data.created_at).getTime() / 1000 : Date.now() / 1000
        } as Tweet;

        sentTweets.push(finalTweet);
    }

    const memories: Memory[] = sentTweets.map((tweet) => ({
        id: stringToUuid(tweet.id + "-" + client.runtime.agentId),
        agentId: client.runtime.agentId,
        userId: client.runtime.agentId,
        content: {
            text: tweet.text,
            source: "twitter",
            url: tweet.permanentUrl,
            inReplyTo: tweet.inReplyToStatusId
                ? stringToUuid(
                      tweet.inReplyToStatusId + "-" + client.runtime.agentId
                  )
                : undefined,
        },
        roomId,
        embedding: embeddingZeroVector,
        createdAt: tweet.timestamp * 1000,
    }));

    return memories;
}

function splitTweetContent(content: string): string[] {
    const tweetChunks: string[] = [];
    let currentChunk = "";

    const words = content.split(" ");
    for (const word of words) {
        if (currentChunk.length + word.length + 1 <= MAX_TWEET_LENGTH) {
            currentChunk += (currentChunk ? " " : "") + word;
        } else {
            tweetChunks.push(currentChunk);
            currentChunk = word;
        }
    }

    if (currentChunk) {
        tweetChunks.push(currentChunk);
    }

    return tweetChunks;
}
