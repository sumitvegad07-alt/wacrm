import Link from "next/link";
import { MessageSquare } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 group mb-4 inline-flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <MessageSquare className="h-4 w-4" />
              </div>
              <span className="text-xl font-bold tracking-tight text-foreground">
                WACRM <span className="text-primary">BOS</span>
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs mb-6">
              The ultimate Business Operating System powered by WhatsApp and Agentic AI.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm font-medium">Twitter</a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors text-sm font-medium">LinkedIn</a>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold text-foreground mb-4">Product</h4>
            <ul className="space-y-3">
              <li><Link href="#features" className="text-sm text-muted-foreground hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="#industries" className="text-sm text-muted-foreground hover:text-primary transition-colors">Industries</Link></li>
              <li><Link href="#pricing" className="text-sm text-muted-foreground hover:text-primary transition-colors">Pricing</Link></li>
              <li><Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors">Sign In</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-foreground mb-4">Legal</h4>
            <ul className="space-y-3">
              <li><a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Terms of Service</a></li>
              <li><a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Data Processing</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-border pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} WACRM BOS. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
