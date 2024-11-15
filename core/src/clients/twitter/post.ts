// src/clients/twitter/post.ts
import { Tweet, ClientBase } from "./base.ts";  // Using our own tweet
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import { log_to_file } from "../../core/logger.ts";
import { embeddingZeroVector } from "../../core/memory.ts";
import { IAgentRuntime, ModelClass } from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { generateText } from "../../core/generation.ts";
//import { TwitterApi } from "twitter-api-v2";

const twitterPostTemplate = `{{timeline}}

{{providers}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{postDirections}}

{{recentPosts}}

{{characterPostExamples}}

# Task: Generate a post not more than 280 characters in the voice and style of {{agentName}}, aka @{{twitterUserName}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.Including new line characters(\\n) and double spaces(\\n\\n), the sentence should not be more than 280 characters.`;

export class TwitterPostClient extends ClientBase {
    onReady() {
        const generateNewTweetLoop = () => {
            this.generateNewTweet();
            setTimeout(
                generateNewTweetLoop,
                (Math.floor(Math.random() * (20 - 2 + 1)) + 2) * 60 * 1000
            ); // Random interval between 4-8 hours
        };
        // setTimeout(() => {
        generateNewTweetLoop();
        // }, 5 * 60 * 1000); // Wait 5 minutes before starting the loop
    }

    constructor(runtime: IAgentRuntime) {
        // Initialize the client and pass an optional callback to be called when the client is ready
        super({
            runtime,
        });
    }

    private async generateNewTweet() {
        console.log("Generating new tweet");
        try {
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );

            let homeTimeline = [];

            if (!fs.existsSync("tweetcache")) fs.mkdirSync("tweetcache");
            
            if (fs.existsSync("tweetcache/home_timeline.json")) {
                homeTimeline = JSON.parse(
                    fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
                );
            } else {
                // Using v2 API to fetch timeline
                const timelineResult = await this.twitterClient.v2.homeTimeline({
                    max_results: 50,
                    "tweet.fields": ["created_at", "conversation_id", "in_reply_to_user_id"],
                    "user.fields": ["name", "username"],
                    expansions: ["author_id"]
                });

                homeTimeline = await this.fetchHomeTimeline(50);
                fs.writeFileSync(
                    "tweetcache/home_timeline.json",
                    JSON.stringify(homeTimeline, null, 2)
                );
            }

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");

            
            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid("twitter_generate_room"),
                    agentId: this.runtime.agentId,
                    content: { text: "", action: "" },
                },
                {
                    twitterUserName:
                        this.runtime.getSetting("TWITTER_USERNAME"),
                    timeline: formattedHomeTimeline,
                }
            );

            // Generate new tweet
            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterPostTemplate ||
                    twitterPostTemplate,
            });

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });


            const content = newTweetContent.replaceAll(/\\n/g, "\n").trim().slice(0, 280);

            if (!this.dryRun) {
                try {
                    // Using v2 API to create tweet
                    const tweetResponse = await this.twitterClient.v2.tweet(content);

                    if (!tweetResponse.data) {
                        throw new Error("Failed to create tweet");
                    }

                    // Get the full tweet details
                    const tweetDetails = await this.twitterClient.v2.singleTweet(
                        tweetResponse.data.id,
                        {
                            "tweet.fields": ["created_at", "conversation_id", "in_reply_to_user_id"],
                            "user.fields": ["name", "username"]
                        }
                    );

                    const tweet: Tweet = {
                        id: tweetResponse.data.id,
                        text: content,
                        conversationId: tweetDetails.data.conversation_id || tweetResponse.data.id,
                        createdAt: tweetDetails.data.created_at || new Date().toISOString(),
                        userId: this.twitterUserId,
                        permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResponse.data.id}`,
                        hashtags: [],
                        mentions: [],
                        photos: [],
                        thread: [],
                        urls: [],
                        videos: [],
                        timestamp: Date.now()
                    };

                    const postId = tweet.id;
                    const conversationId = tweet.conversationId + "-" + this.runtime.agentId;
                    const roomId = stringToUuid(conversationId);

                    await this.runtime.ensureRoomExists(roomId);
                    await this.runtime.ensureParticipantInRoom(
                        this.runtime.agentId,
                        roomId
                    );

                    await this.cacheTweet(tweet);

                    await this.runtime.messageManager.createMemory({
                        id: stringToUuid(postId + "-" + this.runtime.agentId),
                        userId: this.runtime.agentId,
                        agentId: this.runtime.agentId,
                        content: {
                            text: newTweetContent.trim(),
                            url: tweet.permanentUrl,
                            source: "twitter",
                        },
                        roomId,
                        embedding: embeddingZeroVector,
                        createdAt: tweet.timestamp,
                    });
                } catch (error) {
                    console.error("Error sending tweet:", error);
                    throw error;
                }
            } else {
                console.log("Dry run, not sending tweet:", newTweetContent);
            }
        } catch (error) {
            console.error("Error generating new tweet:", error);
            throw error;
        }
    }
}
