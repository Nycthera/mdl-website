import { MdBook } from "react-icons/md";
import Link from "next/link";

export default function License() {
    return (
        <div className="min-h-screen bg-background">
            {/* Navbar */}
            <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
                <div className="container mx-auto flex h-16 items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <MdBook className="h-6 w-6 text-primary" />
                        <span className="font-bold text-lg">MDL</span>
                    </Link>
                </div>
            </nav>

            <div className="container mx-auto max-w-3xl py-16 px-4">
                {/* Header */}
                <div className="mb-10">
                    <h1 className="text-4xl font-bold mb-2">License</h1>
                    <p className="text-muted-foreground">MIT License — Copyright © 2026 <a href="https://github.com/Nycthera" className="text-primary hover:underline">Chris</a></p>
                </div>

                {/* License text */}
                <div className="rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground leading-7 whitespace-pre-wrap font-mono">
{`Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`}
                </div>
            </div>
        </div>
    );
}