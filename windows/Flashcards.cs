using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.7.2")]

class FlashcardsWindow : Form
{
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
    readonly WebView2 view = new WebView2();
    readonly bool smoke = Environment.GetEnvironmentVariable("FLASHCARDS_SMOKE_TEST") == "1";
    const string Host = "flashcards.example";
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new FlashcardsWindow());
    }
    FlashcardsWindow()
    {
        Text = "Flashcards 3.0";
        AutoScaleDimensions = new System.Drawing.SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Width = 1100; Height = 820; MinimumSize = new System.Drawing.Size(440, 600);
        StartPosition = FormStartPosition.CenterScreen;
        view.Dock = DockStyle.Fill; Controls.Add(view);
        if (smoke) { ShowInTaskbar = false; WindowState = FormWindowState.Minimized; }
        Shown += async (sender, args) => await Initialize();
    }
    static bool IsLocal(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host == Host;
    }
    static void OpenLink(string value)
    {
        Uri uri;
        if (Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
    async Task Initialize()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string profile = smoke ? Path.Combine(root, "smoke-profile") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaazFlashcards", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping(Host, Path.Combine(root, "www"), CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            view.CoreWebView2.Settings.IsWebMessageEnabled = false;
            view.CoreWebView2.NavigationStarting += (sender, args) => {
                if (!IsLocal(args.Uri)) { args.Cancel = true; OpenLink(args.Uri); }
            };
            view.CoreWebView2.NewWindowRequested += (sender, args) => { args.Handled = true; OpenLink(args.Uri); };
            view.CoreWebView2.PermissionRequested += (sender, args) => { args.State = CoreWebView2PermissionState.Deny; };
            if (smoke) view.CoreWebView2.NavigationCompleted += async (sender, args) => {
                await Task.Delay(3000);
                string result = await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify({url:location.href,body:document.body.innerText.slice(0,1500),secure:isSecureContext,indexedDB:!!window.indexedDB})");
                File.WriteAllText(Path.Combine(root, "smoke-result.json"), result);
                File.WriteAllText(Path.Combine(root, "smoke-dpi.txt"), "PerMonitorV2=" + AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(Handle), new IntPtr(-4)));
                Close();
            };
            view.Source = new Uri("https://" + Host + "/index.html");
        }
        catch (Exception error)
        {
            if (smoke) File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "smoke-error.txt"), error.ToString());
            else MessageBox.Show("Flashcards could not start. Install or repair Microsoft Edge WebView2 Runtime, then try again.\n\n" + error.Message, "Flashcards");
            Close();
        }
    }
}
