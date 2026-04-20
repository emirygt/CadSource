import ezdxf
doc = ezdxf.new("R2010")
msp = doc.modelspace()
poly = [(0,0), (10,0), (10,10), (0,10)]
spline = msp.add_spline(fit_points=poly)
spline.closed = True
doc.saveas("test_spline.dxf")
print("Success:", spline)
