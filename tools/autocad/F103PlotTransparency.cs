// SPDX-License-Identifier: GPL-2.0-only
using System;
using Autodesk.AutoCAD.ApplicationServices.Core;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Runtime;

namespace Kuubik.Draw.Parity
{
    public sealed class F103PlotTransparencyCommands
    {
        [CommandMethod("KDF103PLOTTRANSPARENCY")]
        public static void PlotTransparency()
        {
            var document = Application.DocumentManager.MdiActiveDocument;
            if (document == null) throw new InvalidOperationException("No active AutoCAD document.");
            using (var transaction = document.Database.TransactionManager.StartTransaction())
            {
                var layoutId = LayoutManager.Current.GetLayoutId(LayoutManager.Current.CurrentLayout);
                var layout = (Layout)transaction.GetObject(layoutId, OpenMode.ForWrite);
                var request = Convert.ToString(Application.GetSystemVariable("USERS2"));
                if (request == "1") layout.PlotTransparency = true;
                else if (request == "0") layout.PlotTransparency = false;
                else if (request != "?") throw new InvalidOperationException("USERS2 must be 0, 1 or ?.");
                Application.SetSystemVariable("USERS3", layout.PlotTransparency ? "1" : "0");
                transaction.Commit();
            }
        }
    }
}
