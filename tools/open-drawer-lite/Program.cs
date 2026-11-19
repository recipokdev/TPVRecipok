// open-drawer-lite.exe -- MISMO programa que tools/open-drawer/Program.cs (mismos argumentos, mismos mensajes de error y codigos de salida),
// pero compilado contra .NET Framework 4 (que ya trae Windows 10/11): pesa unos pocos KB en vez de los ~64 MB del ejecutable autocontenido
// de .NET 8, no se descomprime en la carpeta temporal al arrancar y es mucho menos sospechoso para un antivirus.
// Caso real (Los Argentinos, 2026-11-19): tras una actualizacion el cajon dejo de abrir con el aviso generico; el programa de 64 MB sin firmar
// es justo el tipo de fichero que un antivirus pone en cuarentena o tarda en analizar. Este es el que el TPV prueba PRIMERO.
// Sintaxis C# 5 a proposito (se compila con el csc.exe que trae Windows, sin SDK): ver build.cmd.
using System;
using System.Runtime.InteropServices;

class Program
{
    // WinSpool RAW printing
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName = "OpenCashDrawer";
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile = null;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType = "RAW";
    }

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    static int Main(string[] args)
    {
        // Uso: open-drawer-lite.exe "<PrinterName>" [pin] [t1] [t2]
        // pin: 0 o 1 (cajon) / t1,t2: duracion del pulso (por defecto 25 y 250)
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Usage: open-drawer-lite.exe \"PrinterName\" [pin] [t1] [t2]");
            return 2;
        }

        string printerName = args[0];
        int pin = 0, t1 = 25, t2 = 250;
        int v;
        if (args.Length >= 2 && int.TryParse(args[1], out v)) pin = v;
        if (args.Length >= 3 && int.TryParse(args[2], out v)) t1 = v;
        if (args.Length >= 4 && int.TryParse(args[3], out v)) t2 = v;

        if (pin != 0 && pin != 1) pin = 0;
        if (t1 < 0 || t1 > 255) t1 = 25;
        if (t2 < 0 || t2 > 255) t2 = 250;

        // ESC p m t1 t2
        byte[] cmd = new byte[] { 0x1B, 0x70, (byte)pin, (byte)t1, (byte)t2 };

        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine("OpenPrinter failed (" + err + ") for '" + printerName + "'");
            return 3;
        }

        try
        {
            DOCINFO di = new DOCINFO();
            int jobId = StartDocPrinter(hPrinter, 1, di);
            if (jobId <= 0)
            {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("StartDocPrinter failed (" + err + ")");
                return 4;
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("StartPagePrinter failed (" + err + ")");
                    return 5;
                }

                try
                {
                    int written;
                    if (!WritePrinter(hPrinter, cmd, cmd.Length, out written) || written != cmd.Length)
                    {
                        int err = Marshal.GetLastWin32Error();
                        Console.Error.WriteLine("WritePrinter failed (" + err + "), written=" + written);
                        return 6;
                    }
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }

            Console.WriteLine("OK");
            return 0;
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
