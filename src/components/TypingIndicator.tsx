export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
        <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}
