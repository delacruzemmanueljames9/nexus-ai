try {
  const extraction = await extractFileWithResult(fileToSend);

  if (extraction.isScanned) {
    toast({
      title: "Scanned PDF Detected",
      description: "This PDF is image-based or scanned. Please use a text-based PDF, Word document, or copy-paste the content instead.",
      variant: "destructive",
    });
    return;
  }

  const fileContext = `\n\n[File: ${fileToSend.name}]\n${extraction.text}`;
  userMessageContent = (trimmed || "") + fileContext;
  userMessageText = (trimmed || "") + fileContext;
} catch {
  toast({ title: "File Error", description: `Could not read ${fileToSend.name}.`, variant: "destructive" });
  return;
}
