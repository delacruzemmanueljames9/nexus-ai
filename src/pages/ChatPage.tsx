const handleSend = async () => {
  const trimmed = input.trim();
  if ((!trimmed && !attachedFile) || streaming) return;

  const fileToSend = attachedFile;
  setInput("");
  setAttachedFile(null);
  if (fileInputRef.current) fileInputRef.current.value = "";
  autoResizeTextarea();

  let conversationId = activeConversationId;
  const isFirstMessage = messages.length === 0;

  if (!conversationId) {
    conversationId = await createConversation(trimmed || fileToSend?.name || "File");
    if (!conversationId) return;
    setActiveConversationId(conversationId);
  }

  let userMessageContent: MessageContent["content"] = trimmed || "";
  let userMessageText = trimmed || "";

  if (fileToSend) {
    const isImage = fileToSend.type.startsWith("image/");

    if (isImage) {
      const base64 = await fileToBase64(fileToSend);
      const dataUrl = `data:${fileToSend.type};base64,${base64}`;
      const publicUrl = await uploadFileToSupabase(fileToSend, conversationId);
      userMessageContent = [
        ...(trimmed ? [{ type: "text", text: trimmed }] : [{ type: "text", text: "Please analyze this image." }]),
        { type: "image_url", image_url: { url: dataUrl } },
      ];
      const imageTag = publicUrl ? `[Image: ${fileToSend.name}|${publicUrl}]` : `[Image: ${fileToSend.name}]`;
      userMessageText = trimmed ? `${trimmed}\n\n${imageTag}` : imageTag;
    } else {
      await uploadFileToSupabase(fileToSend, conversationId);
      const extraction = await extractFileWithResult(fileToSend);

      if (extraction.isScanned) {
        toast({
          title: "Scanned PDF Detected",
          description: "This PDF is image-based or scanned and cannot be read. Please use a text-based PDF, Word document (.docx), or copy-paste the content instead.",
          variant: "destructive",
        });
        setAttachedFile(fileToSend);
        return;
      }

      const prompt = trimmed || "Please analyze this file and summarize its contents.";
      const fileContext = `${prompt}\n\n[File: ${fileToSend.name}]\n${extraction.text}`;
      userMessageContent = fileContext;
      userMessageText = fileContext;
    }
  }

  const tempUserMsg: Message = {
    id: `temp-user-${Date.now()}`,
    conversation_id: conversationId,
    role: "user",
    content: userMessageText,
    created_at: new Date().toISOString(),
  };
  setMessages((prev) => [...prev, tempUserMsg]);

  const savedUserMsg = await saveMessage(conversationId, "user", userMessageText);
  if (savedUserMsg) {
    setMessages((prev) => prev.map((m) => m.id === tempUserMsg.id ? savedUserMsg : m));
  }

  // ✅ FIX: spread current messages + tempUserMsg so the first message is never dropped
  const allCurrentMessages = [...messages, tempUserMsg];
  const history: MessageContent[] = allCurrentMessages.slice(-6).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.id === tempUserMsg.id ? userMessageContent : m.content,
  }));

  const tempAssistantMsg: Message = {
    id: `temp-assistant-${Date.now()}`,
    conversation_id: conversationId,
    role: "assistant",
    content: "",
    created_at: new Date().toISOString(),
  };
  setMessages((prev) => [...prev, tempAssistantMsg]);
  setStreaming(true);
  abortRef.current = false;

  let fullContent = "";

  try {
    await streamGroqResponse(history, ({ content, done }) => {
      if (abortRef.current) return;
      if (!done) {
        fullContent += content;
        setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m));
      } else {
        if (fullContent) {
          saveMessage(conversationId!, "assistant", fullContent).then((saved) => {
            if (saved) setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? saved : m));
          });
          updateConversationTimestamp(conversationId!);
          if (isFirstMessage) autoRenameConversation(conversationId!, userMessageText, fullContent);
        }
      }
    });
  } catch (err: unknown) {
    if (!abortRef.current) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to get AI response", variant: "destructive" });
      setMessages((prev) => prev.filter((m) => m.id !== tempAssistantMsg.id));
    }
  } finally {
    setStreaming(false);
  }
};
