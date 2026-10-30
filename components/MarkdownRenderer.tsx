import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

// Helper function to check if a React Node contains specific text recursively
const hasText = (node: any, text: string): boolean => {
    if (!node) return false;
    if (typeof node === 'string') return node.includes(text);
    if (Array.isArray(node)) return node.some(child => hasText(child, text));
    if (node.props && node.props.children) return hasText(node.props.children, text);
    return false;
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="markdown-content text-sm text-gray-800 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
            code({ className, children, ...props }) {
              return (
                <code className={`${className} bg-gray-100 rounded px-1 py-0.5 text-red-600 font-mono text-sm`} {...props}>
                  {children}
                </code>
              );
            },
            pre({ children }) {
                return <pre className="bg-gray-900 text-white p-4 rounded-lg overflow-x-auto my-4">{children}</pre>
            },
            div({ className, children, ...props }) {
                // Hiển thị vạch ngắt trang trực quan cho cả 2 loại thẻ AI hay dùng
                if (className === 'page-break' || className === 'word-page-break') {
                    return (
                        <div className="my-10 flex items-center gap-4 text-blue-400 select-none print:hidden">
                            <div className="flex-1 border-t-2 border-dashed border-blue-200"></div>
                            <span className="text-[10px] font-bold uppercase tracking-widest bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 shadow-sm">BẮT ĐẦU TRANG MỚI TRONG WORD</span>
                            <div className="flex-1 border-t-2 border-dashed border-blue-200"></div>
                        </div>
                    );
                }
                return <div className={className} {...props}>{children}</div>;
            },
            table({ children, ...props }) {
                // Heuristic: Check if this is a "Header Layout" table by looking for "KHOA" or "BỘ MÔN"
                const isHeaderTable = hasText(children, "KHOA") || hasText(children, "BỘ MÔN");
                
                if (isHeaderTable) {
                    // Header Table: No borders, very tight spacing (leading-none), no bottom margin
                    return <table className="w-full border-collapse mb-2 leading-none" {...props}>{children}</table>;
                }
                
                // Default: Standard data table with borders (for Answer Key Body)
                return (
                    <div className="overflow-x-auto mb-6">
                        <table className="w-full border-collapse border border-gray-300" {...props}>
                            {children}
                        </table>
                    </div>
                );
            },
            th({ children, ...props }) {
                 const text = String(children); 
                 const isLayoutHeader = text.includes("KHOA") || text.includes("BỘ MÔN");
                 
                 if (isLayoutHeader) {
                     // Header Layout Table Cell
                     // Padding 0 for left side to prevent indentation
                     return <th className="p-1 text-left align-top font-normal border-none" {...props}>{children}</th>
                 }
                 
                 // Standard Answer Key Header
                 return <th className="border border-gray-300 bg-gray-100 p-2 text-left font-bold" {...props}>{children}</th>
            },
            td({ children, ...props }) {
                return <td className="border border-gray-300 p-2 align-top" {...props}>{children}</td>
            }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;