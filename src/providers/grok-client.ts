import { gotScraping } from "got-scraping";
import { CookieJar } from "tough-cookie";
import { chromium } from "patchright";
import * as fs from "fs";
import * as path from "path";

// A utility function for delay
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface GrokResponseToken {
  token: string;
  isThinking: boolean;
  isSoftStop: boolean;
  responseId: string;
}

export interface GrokFinalMetadata {
  followUpSuggestions: string[];
  feedbackLabels: string[];
  toolsUsed: Record<string, any>;
}

export interface GrokModelResponse {
  responseId: string;
  message: string;
  sender: string;
  createTime: string;
  parentResponseId: string;
  manual: boolean;
  partial: boolean;
  shared: boolean;
  query: string;
  queryType: string;
  webSearchResults: any[];
  xpostIds: string[];
  xposts: any[];
  generatedImageUrls: string[];
  imageAttachments: any[];
  fileAttachments: any[];
  cardAttachmentsJson: any[];
  fileUris: string[];
  fileAttachmentsMetadata: any[];
  isControl: boolean;
  steps: any[];
  mediaTypes: string[];
}

export interface GrokTitle {
  newTitle: string;
}

export interface GrokConversation {
  conversationId: string;
  title: string;
  starred: boolean;
  createTime: string;
  modifyTime: string;
  systemPromptName: string;
  temporary: boolean;
  mediaTypes: string[];
}

export interface GrokResponse {
  result: {
    response?: {
      token?: string;
      isThinking?: boolean;
      isSoftStop?: boolean;
      responseId?: string;
      finalMetadata?: GrokFinalMetadata;
      modelResponse?: GrokModelResponse;
      userResponse?: any;
    };
    title?: GrokTitle;
    token?: string;
    isThinking?: boolean;
    isSoftStop?: boolean;
    responseId?: string;
    finalMetadata?: GrokFinalMetadata;
    modelResponse?: GrokModelResponse;
    userResponse?: any;
    conversation?: GrokConversation;
  };
}

export interface ParsedGrokResponse {
  fullMessage: string;
  responseId: string | undefined;
  title: string | undefined;
  metadata: GrokFinalMetadata | undefined;
  modelResponse: GrokModelResponse | undefined;
  conversationId: string | undefined;
}

export interface GrokSendMessageOptions {
  message: string;
  disableSearch?: boolean;
  enableImageGeneration?: boolean;
  customInstructions?: string;
  forceConcise?: boolean;
  imageAttachments?: GrokImageAttachment[];
  conversationId?: string;
  parentResponseId?: string;
  isReasoning?: boolean;
}

export interface GrokImageAttachment {
  fileMetadataId: string;
  fileMimeType: string;
  fileName: string;
  fileUri: string;
  parsedFileUri: string;
  createTime: string;
}

export interface GrokUploadResponse {
  fileMetadataId: string;
  fileMimeType: string;
  fileName: string;
  fileUri: string;
  parsedFileUri: string;
  createTime: string;
}

export interface GrokStreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (response: ParsedGrokResponse) => void;
  onError?: (error: any) => void;
}

export class GrokAPI {
  private cookieStrings: string[];
  private lastConversationId: string = "new";
  private lastResponseId: string = "";
  private cookiesPath: string;

  constructor(cookieStrings?: string[], cookiesPath?: string) {
    this.cookiesPath =
      cookiesPath || path.join(process.cwd(), "grok-cookies.json");

    if (cookieStrings && cookieStrings.length > 0) {
      this.cookieStrings = cookieStrings;
    } else {
      this.cookieStrings = this.loadCookiesFromFile() || [];
      if (this.cookieStrings.length === 0) {
        console.log(
          "No cookies found. Please run the login method to authenticate."
        );
      }
    }
  }

  private loadCookiesFromFile(): string[] | null {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesData = fs.readFileSync(this.cookiesPath, "utf-8");
        return JSON.parse(cookiesData);
      }
    } catch (error) {
      console.error("Error loading cookies from file:", error);
    }
    return null;
  }

  private saveCookiesToFile(cookies: string[]): void {
    try {
      fs.writeFileSync(
        this.cookiesPath,
        JSON.stringify(cookies, null, 2),
        "utf-8"
      );
      console.log("Cookies saved to:", this.cookiesPath);
    } catch (error) {
      console.error("Error saving cookies to file:", error);
    }
  }

  /**
   * Automates the login process using patchright
   * @param username The Grok username (email)
   * @param password The Grok password
   */
  async login(username: string, password: string): Promise<boolean> {
    console.log("Starting automated login process...");

    try {
      const browser = await chromium.launchPersistentContext(
        path.join(__dirname, "..", ".chrome-data"),
        {
          channel: "chrome",
          headless: false,
          viewport: null,
        }
      );

      const page = await browser.newPage();

      await page.goto("https://accounts.x.ai/sign-in?redirect=grok-com", {
        waitUntil: "domcontentloaded",
      });
      console.log("Navigated to X.AI sign-in page");
      await page.waitForSelector('button[type="submit"]', { timeout: 30000 });
      await page.click('input[data-testid="email"]');
      await page.fill('input[data-testid="email"]', username);
      await page.waitForSelector('input[type="password"]', { timeout: 30000 });
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      console.log("Logging in and waiting for redirect to Grok...");
      await page.waitForURL((url) => url.hostname.includes("grok.com"), {
        timeout: 60000,
      });
      await delay(3000);
      const cookies = await browser.cookies();
      const essentialCookies = this.extractEssentialCookies(cookies);
      if (essentialCookies.length === 0) {
        console.error("Failed to get essential Grok cookies after login");
        await browser.close();
        return false;
      }

      this.cookieStrings = essentialCookies;
      this.saveCookiesToFile(essentialCookies);
      console.log("Extracted and saved cookies");

      await browser.close();
      return true;
    } catch (error) {
      console.error("Error during automated login:", error);
      return false;
    }
  }

  isAuthenticated(): boolean {
    return this.cookieStrings.length > 0;
  }

  /**
   * Ensures the user is authenticated before making API calls
   * @param username Optional username for login
   * @param password Optional password for login
   */
  async ensureAuthenticated(
    username?: string,
    password?: string
  ): Promise<boolean> {
    if (this.isAuthenticated()) {
      return true;
    }

    if (!username || !password) {
      throw new Error(
        "Authentication required: No valid cookies found and no login credentials provided"
      );
    }

    return this.login(username, password);
  }

  async sendMessage(
    options: GrokSendMessageOptions
  ): Promise<ParsedGrokResponse> {
    if (!this.isAuthenticated()) {
      throw new Error(
        "Authentication required: Please call login() method first or provide cookies"
      );
    }

    try {
      const {
        message,
        conversationId = "new",
        parentResponseId = "",
        disableSearch = false,
        enableImageGeneration = true,
        customInstructions = "",
        forceConcise = false,
        imageAttachments = [],
        isReasoning = false,
      } = options;

      const isNewConversation = conversationId === "new";
      const url = isNewConversation
        ? "https://grok.com/rest/app-chat/conversations/new"
        : `https://grok.com/rest/app-chat/conversations/${conversationId}/responses`;

      console.log(
        `Sending message to ${
          isNewConversation ? "new conversation" : "existing conversation"
        }: ${conversationId}`
      );

      const response = await gotScraping.post(url, {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          origin: "https://grok.com",
          referer: "https://grok.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        cookieJar: this.setCookies(this.cookieStrings, "https://grok.com"),
        json: {
          temporary: false,
          modelName: "grok-3",
          message: message,
          fileAttachments: [],
          imageAttachments: imageAttachments,
          disableSearch: disableSearch,
          enableImageGeneration: enableImageGeneration,
          returnImageBytes: false,
          returnRawGrokInXaiRequest: false,
          enableImageStreaming: true,
          imageGenerationCount: 2,
          forceConcise: forceConcise,
          toolOverrides: {},
          enableSideBySide: false,
          sendFinalMetadata: true,
          customInstructions: customInstructions,
          deepsearchPreset: "",
          isReasoning: isReasoning,
          ...(isNewConversation ? {} : { parentResponseId: parentResponseId }),
        },
      });

      const parsedResponse = this.parseGrokResponse(response.body);

      if (parsedResponse.conversationId) {
        this.lastConversationId = parsedResponse.conversationId;
      }

      if (parsedResponse.responseId) {
        this.lastResponseId = parsedResponse.responseId;
      }

      return parsedResponse;
    } catch (error: any) {
      console.error("Error sending message to Grok:", error);

      if (
        error.response &&
        (error.response.statusCode === 401 || error.response.statusCode === 403)
      ) {
        console.error(
          "Authentication error: Your session may have expired. Try logging in again."
        );
        this.cookieStrings = [];
      }

      throw error;
    }
  }

  async continueConversation(
    message: string,
    options: Omit<GrokSendMessageOptions, "message"> = {}
  ): Promise<ParsedGrokResponse> {
    if (!this.isAuthenticated()) {
      throw new Error(
        "Authentication required: Please call login() method first or provide cookies"
      );
    }

    if (this.lastConversationId === "new") {
      throw new Error(
        "No active conversation to continue. Start a new conversation first."
      );
    }

    console.log(
      `Continuing conversation ${this.lastConversationId} with parent response ${this.lastResponseId}`
    );

    try {
      return await this.sendMessage({
        message,
        conversationId: this.lastConversationId,
        parentResponseId: this.lastResponseId,
        ...options,
      });
    } catch (error: any) {
      if (
        error.response &&
        (error.response.statusCode === 401 || error.response.statusCode === 403)
      ) {
        console.error(
          "Failed to continue conversation: Your session may have expired."
        );
      }
      throw error;
    }
  }

  getConversationInfo() {
    return {
      conversationId: this.lastConversationId,
      lastResponseId: this.lastResponseId,
    };
  }

  private parseGrokResponse(responseBody: string): ParsedGrokResponse {
    const jsonLines = responseBody.trim().split("\n");

    let fullMessage = "";
    let responseId: string | undefined;
    let title: string | undefined;
    let metadata: GrokFinalMetadata | undefined;
    let modelResponse: GrokModelResponse | undefined;
    let conversationId: string | undefined;

    for (const line of jsonLines) {
      try {
        const parsedLine: GrokResponse = JSON.parse(line);

        if (
          parsedLine.result &&
          parsedLine.result.conversation &&
          parsedLine.result.conversation.conversationId
        ) {
          conversationId = parsedLine.result.conversation.conversationId;
          console.log(`Found conversation ID: ${conversationId}`);
        }

        if (
          parsedLine.result &&
          parsedLine.result.response &&
          parsedLine.result.response.token !== undefined
        ) {
          fullMessage += parsedLine.result.response.token;
          responseId = parsedLine.result.response.responseId;
        }

        if (parsedLine.result && parsedLine.result.token !== undefined) {
          fullMessage += parsedLine.result.token || "";
          responseId = parsedLine.result.responseId;
        }

        if (
          parsedLine.result &&
          parsedLine.result.response &&
          parsedLine.result.response.finalMetadata
        ) {
          metadata = parsedLine.result.response.finalMetadata;
        } else if (parsedLine.result && parsedLine.result.finalMetadata) {
          metadata = parsedLine.result.finalMetadata;
        }

        if (
          parsedLine.result &&
          parsedLine.result.response &&
          parsedLine.result.response.modelResponse
        ) {
          modelResponse = parsedLine.result.response.modelResponse;
          responseId = modelResponse.responseId;
        } else if (parsedLine.result && parsedLine.result.modelResponse) {
          modelResponse = parsedLine.result.modelResponse;
          responseId = modelResponse.responseId;
        }

        if (parsedLine.result && parsedLine.result.title) {
          title = parsedLine.result.title.newTitle;
        }

        if (
          parsedLine.result &&
          parsedLine.result.response &&
          parsedLine.result.response.userResponse &&
          parsedLine.result.response.userResponse.responseId
        ) {
          responseId = parsedLine.result.response.userResponse.responseId;
        } else if (
          parsedLine.result &&
          parsedLine.result.userResponse &&
          parsedLine.result.userResponse.responseId
        ) {
          responseId = parsedLine.result.userResponse.responseId;
        }
      } catch (error) {
        console.error("Error parsing JSON line:", error);
      }
    }

    if (modelResponse?.message && !fullMessage) {
      fullMessage = modelResponse.message;
    }

    return {
      fullMessage,
      responseId,
      title,
      metadata,
      modelResponse,
      conversationId,
    };
  }

  private setCookies(cookieStrings: string[], url: string) {
    const cookieJar = new CookieJar();

    for (const cookieString of cookieStrings) {
      const [key, value] = cookieString.split("=");
      cookieJar.setCookieSync(`${key}=${value}`, url);
    }

    return cookieJar;
  }

  async sendMessageStream(
    options: GrokSendMessageOptions,
    callbacks: GrokStreamCallbacks
  ): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error(
        "Authentication required: Please call login() method first or provide cookies"
      );
    }

    try {
      const {
        message,
        conversationId = "new",
        parentResponseId = "",
        disableSearch = false,
        enableImageGeneration = true,
        customInstructions = "",
        forceConcise = false,
        imageAttachments = [],
        isReasoning = false,
      } = options;

      const isNewConversation = conversationId === "new";
      const url = isNewConversation
        ? "https://grok.com/rest/app-chat/conversations/new"
        : `https://grok.com/rest/app-chat/conversations/${conversationId}/responses`;

      console.log(
        `Streaming message to ${
          isNewConversation ? "new conversation" : "existing conversation"
        }: ${conversationId}`
      );

      // Initialize accumulated response data
      let fullMessage = "";
      let responseId: string | undefined;
      let title: string | undefined;
      let metadata: GrokFinalMetadata | undefined;
      let modelResponse: GrokModelResponse | undefined;
      let conversationId_: string | undefined;
      let accumulator = "";

      // Create a stream request
      const stream = gotScraping.stream.post(url, {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          origin: "https://grok.com",
          referer: "https://grok.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        cookieJar: this.setCookies(this.cookieStrings, "https://grok.com"),
        json: {
          temporary: false,
          modelName: "grok-2",
          message: message,
          fileAttachments: [],
          imageAttachments: imageAttachments,
          disableSearch: disableSearch,
          enableImageGeneration: enableImageGeneration,
          returnImageBytes: false,
          returnRawGrokInXaiRequest: false,
          enableImageStreaming: true,
          imageGenerationCount: 2,
          forceConcise: forceConcise,
          toolOverrides: {},
          enableSideBySide: false,
          sendFinalMetadata: true,
          customInstructions: customInstructions,
          deepsearchPreset: "",
          isReasoning: isReasoning,
          ...(isNewConversation ? {} : { parentResponseId: parentResponseId }),
        },
      });

      // Process the stream data
      stream.on("data", (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        accumulator += chunkStr;

        // Process complete JSON lines
        let lineEnd = accumulator.indexOf("\n");
        while (lineEnd !== -1) {
          const line = accumulator.substring(0, lineEnd);
          accumulator = accumulator.substring(lineEnd + 1);

          try {
            if (line.trim()) {
              const parsedLine: GrokResponse = JSON.parse(line);

              // Handle conversation ID
              if (parsedLine.result?.conversation?.conversationId) {
                conversationId_ = parsedLine.result.conversation.conversationId;
                console.log(`Found conversation ID: ${conversationId_}`);
              }

              // Handle token and send it via callback
              let token: string | undefined;

              if (parsedLine.result?.response?.token !== undefined) {
                token = parsedLine.result.response.token;
                responseId = parsedLine.result.response.responseId;
              } else if (parsedLine.result?.token !== undefined) {
                token = parsedLine.result.token || "";
                responseId = parsedLine.result.responseId;
              }

              if (token !== undefined) {
                fullMessage += token;
                if (callbacks.onToken) {
                  callbacks.onToken(token);
                }
              }

              // Handle metadata
              if (parsedLine.result?.response?.finalMetadata) {
                metadata = parsedLine.result.response.finalMetadata;
              } else if (parsedLine.result?.finalMetadata) {
                metadata = parsedLine.result.finalMetadata;
              }

              // Handle model response
              if (parsedLine.result?.response?.modelResponse) {
                modelResponse = parsedLine.result.response.modelResponse;
                responseId = modelResponse.responseId;
              } else if (parsedLine.result?.modelResponse) {
                modelResponse = parsedLine.result.modelResponse;
                responseId = modelResponse.responseId;
              }

              // Handle title
              if (parsedLine.result?.title) {
                title = parsedLine.result.title.newTitle;
              }

              // Handle user response
              if (parsedLine.result?.response?.userResponse?.responseId) {
                responseId = parsedLine.result.response.userResponse.responseId;
              } else if (parsedLine.result?.userResponse?.responseId) {
                responseId = parsedLine.result.userResponse.responseId;
              }
            }
          } catch (error) {
            console.error("Error parsing JSON line:", error);
          }

          lineEnd = accumulator.indexOf("\n");
        }
      });

      // Handle the completion of the stream
      stream.on("end", () => {
        // Check if there's any data left in the accumulator
        if (accumulator.trim()) {
          try {
            const parsedLine: GrokResponse = JSON.parse(accumulator);

            // Process any remaining tokens or data
            if (parsedLine.result?.conversation?.conversationId) {
              conversationId_ = parsedLine.result.conversation.conversationId;
            }

            let token: string | undefined;
            if (parsedLine.result?.response?.token !== undefined) {
              token = parsedLine.result.response.token;
              responseId = parsedLine.result.response.responseId;
            } else if (parsedLine.result?.token !== undefined) {
              token = parsedLine.result.token || "";
              responseId = parsedLine.result.responseId;
            }

            if (token !== undefined) {
              fullMessage += token;
              if (callbacks.onToken) {
                callbacks.onToken(token);
              }
            }

            if (parsedLine.result?.response?.finalMetadata) {
              metadata = parsedLine.result.response.finalMetadata;
            } else if (parsedLine.result?.finalMetadata) {
              metadata = parsedLine.result.finalMetadata;
            }

            if (parsedLine.result?.response?.modelResponse) {
              modelResponse = parsedLine.result.response.modelResponse;
              responseId = modelResponse.responseId;
            } else if (parsedLine.result?.modelResponse) {
              modelResponse = parsedLine.result.modelResponse;
              responseId = modelResponse.responseId;
            }
          } catch (error) {
            console.error("Error parsing final JSON fragment:", error);
          }
        }

        // Use the model response message if we don't have a full message yet
        if (modelResponse?.message && !fullMessage) {
          fullMessage = modelResponse.message;
        }

        // Store the conversation ID and response ID
        if (conversationId_) {
          this.lastConversationId = conversationId_;
        }

        if (responseId) {
          this.lastResponseId = responseId;
        }

        // Create the final response object
        const parsedResponse: ParsedGrokResponse = {
          fullMessage,
          responseId,
          title,
          metadata,
          modelResponse,
          conversationId: conversationId_,
        };

        // Call the onComplete callback
        if (callbacks.onComplete) {
          callbacks.onComplete(parsedResponse);
        }
      });

      // Handle errors
      stream.on("error", (error: any) => {
        console.error("Error streaming message from Grok:", error);

        if (
          error.response &&
          (error.response.statusCode === 401 ||
            error.response.statusCode === 403)
        ) {
          console.error(
            "Authentication error: Your session may have expired. Try logging in again."
          );
          this.cookieStrings = [];
        }

        if (callbacks.onError) {
          callbacks.onError(error);
        }
      });
    } catch (error: any) {
      console.error("Error setting up streaming request to Grok:", error);

      if (callbacks.onError) {
        callbacks.onError(error);
      }
    }
  }

  private extractEssentialCookies(
    cookies: Array<{ name: string; value: string; domain?: string }>
  ): string[] {
    const cookieStrings = cookies.map(
      (cookie) => `${cookie.name}=${cookie.value}`
    );

    return cookieStrings.filter((cookieString) => {
      const name = cookieString.split("=")[0];
      return [
        // Grok-specific cookies
        "x-anonuserid",
        "x-challenge",
        "x-signature",
        "sso",
        "sso-rw",
        // X.AI authentication cookies
        "next-auth.session-token",
        "next-auth.csrf-token",
        "next-auth.callback-url",
        "__Secure-next-auth.session-token",
        "__Secure-next-auth.callback-url",
        "__Host-next-auth.csrf-token",
      ].includes(name as string);
    });
  }
}
