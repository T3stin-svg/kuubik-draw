using System;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;

[assembly: CommandClass(typeof(Kuubik.Draw.Parity.F027StretchPoints))]

namespace Kuubik.Draw.Parity
{
    public static class F027StretchPoints
    {
        private static void ForEachF027Entity(Action<Editor, Entity> action, OpenMode mode)
        {
            Document document = Application.DocumentManager.MdiActiveDocument;
            Editor editor = document.Editor;
            Database database = document.Database;
            using (Transaction transaction = database.TransactionManager.StartTransaction())
            {
                BlockTable table = (BlockTable)transaction.GetObject(database.BlockTableId, OpenMode.ForRead);
                BlockTableRecord model = (BlockTableRecord)transaction.GetObject(table[BlockTableRecord.ModelSpace], OpenMode.ForRead);
                foreach (ObjectId id in model)
                {
                    Entity entity = transaction.GetObject(id, mode) as Entity;
                    if (entity == null || !entity.Layer.StartsWith("F027_", StringComparison.Ordinal)) continue;
                    action(editor, entity);
                }
                if (mode == OpenMode.ForWrite) transaction.Commit();
            }
        }

        [CommandMethod("F027POINTS", CommandFlags.Session)]
        public static void PrintStretchPoints()
        {
            ForEachF027Entity((editor, entity) =>
            {
                Point3dCollection points = new Point3dCollection();
                entity.GetStretchPoints(points);
                editor.WriteMessage("\nF027_STRETCH_POINTS={0}|{1}|{2}", entity.Layer, entity.GetType().Name, entity.Handle);
                for (int index = 0; index < points.Count; index += 1)
                {
                    Point3d point = points[index];
                    editor.WriteMessage("|{0}:{1:R},{2:R},{3:R}", index, point.X, point.Y, point.Z);
                }
            }, OpenMode.ForRead);
        }

    }
}
