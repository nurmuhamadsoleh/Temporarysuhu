import { Activity, Thermometer, Snowflake } from "lucide-react";
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand text-white">
          <span className="brand-icon">
            <Activity />
          </span>
          TempControl
        </div>
        <div>
          <span className="eyebrow">KITCHEN TEMPERATURE INTELLIGENCE</span>
          <h1>
            Kualitas terjaga.
            <br />
            Setiap derajatnya.
          </h1>
          <p>
            Satu ruang untuk memantau suhu penyimpanan, mendokumentasikan
            pengukuran, dan menjaga standar operasional dapur Anda.
          </p>
          <div className="login-devices">
            <span>
              <Thermometer />
              Chiller Monitoring
            </span>
            <span>
              <Snowflake />
              Freezer Monitoring
            </span>
          </div>
        </div>
        <small>PT Boga Rasa Tama · Temperature Monitoring System · WIB</small>
      </section>
      <section className="login-form">
        <div>{children}</div>
      </section>
    </div>
  );
}
