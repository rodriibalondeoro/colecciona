import LegalPage from "@/components/LegalPage";
import styles from "@/components/LegalPage.module.css";

export const metadata = {
  title: "Política de Privacidad — Colecciona",
};

export default function PrivacidadPage() {
  return (
    <LegalPage title="Política de Privacidad" updated="5 de agosto de 2026">
      <Section title="1. Responsable del tratamiento">
        <p>
          El responsable del tratamiento es{" "}
          <strong>[Nombre legal de tu empresa o tu nombre]</strong>, con domicilio
          en <strong>[Dirección completa]</strong>, NIF/CIF{" "}
          <strong>[NIF o CIF]</strong> (en adelante, «Colecciona», «nosotros»).
          Contacto de privacidad:{" "}
          <a href="mailto:privacidad@colecciona.app">[email real de privacidad]</a>.
        </p>
        <p>
          Tratamos tus datos de acuerdo con el Reglamento (UE) 2016/679 (RGPD) y la
          Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales
          y garantía de los derechos digitales (LOPDGDD).
        </p>
      </Section>

      <Section title="2. Datos que recogemos">
        <ul>
          <li>
            <strong>Datos de registro:</strong> nombre, apellidos, correo electrónico
            y número de teléfono.
          </li>
          <li>
            <strong>Datos de la cuenta:</strong> nombre de usuario, foto de perfil, país
            de residencia y preferencias.
          </li>
          <li>
            <strong>Datos de transacciones:</strong> artículos publicados, compras,
            ventas, valoraciones, mensajes entre usuarios e historial de reclamaciones.
          </li>
          <li>
            <strong>Datos de verificación:</strong> registros de verificación por SMS y,
            en su caso, documentación de identidad o dirección.
          </li>
          <li>
            <strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo,
            sistema operativo, navegador, área geográfica aproximada y datos de uso.
          </li>
        </ul>
      </Section>

      <Section title="3. Finalidades y bases legales">
        <ul>
          <li>
            Prestar el servicio y gestionar tu cuenta, publicaciones y transacciones:
            ejecución del contrato (art. 6.1.b RGPD).
          </li>
          <li>
            Verificar la identidad y prevenir el fraude, las cuentas múltiples y el
            abuso: cumplimiento de obligaciones legales e interés legítimo (art.
            6.1.c y 6.1.f RGPD).
          </li>
          <li>
            Gestionar pagos en custodia, reclamaciones y devoluciones: ejecución del
            contrato.
          </li>
          <li>
            Enviarte comunicaciones imprescindibles (seguridad, cambios en los
            términos): interés legítimo y obligación legal.
          </li>
          <li>
            Enviarte comunicaciones comerciales: únicamente con tu consentimiento
            previo (art. 6.1.a RGPD), revocable en cualquier momento.
          </li>
          <li>
            Mejorar la seguridad y el funcionamiento de la plataforma: interés
            legítimo.
          </li>
        </ul>
      </Section>

      <Section title="4. Decisiones automatizadas y perfilado">
        <p>
          Utilizamos análisis automatizados (incluido el tratamiento de tu número de
          teléfono, dispositivo e historial) para la prevención del fraude y el
          abuso (detección de multicuentas y bots). Estas decisiones pueden dar lugar
          al bloqueo o la verificación de la cuenta. Tienes derecho a solicitar
          intervención humana y a impugnar dichas decisiones, conforme al artículo
          22 RGPD.
        </p>
      </Section>

      <Section title="5. Conservación de los datos">
        <p>
          Conservamos tus datos mientras tengas una cuenta activa y durante los
          plazos de prescripción legal aplicables (fiscales, contables y
          mercantiles). Al cerrar la cuenta eliminamos o anonimizamos tus datos, salvo
          que debamos conservar algunos por obligaciones legales o para la resolución
          de reclamaciones.
        </p>
      </Section>

      <Section title="6. Destinatarios y encargados">
        <p>
          No vendemos tus datos personales. Solo compartimos lo necesario con
          encargados del tratamiento que nos prestan servicios (proveedores de SMS,
          pasarelas de pago, alojamiento, envíos y soporte técnico), bajo acuerdos
          de confidencialidad y solo para las finalidades descritas.
        </p>
      </Section>

      <Section title="7. Transferencias internacionales">
        <p>
          Si transferimos datos a proveedores fuera del Espacio Económico Europeo,
          garantizaremos un nivel adecuado de protección mediante decisiones de
          adecuación, cláusulas contractuales tipo u otros mecanismos reconocidos por
          la normativa aplicable.
        </p>
      </Section>

      <Section title="8. Cookies y tecnologías similares">
        <p>
          Podemos usar cookies técnicas necesarias para el funcionamiento y la
          seguridad de la plataforma. Las cookies de seguimiento, marketing o de
          terceros solo se usarán con tu consentimiento previo, que podrás gestionar
          desde la configuración de tu navegador o los ajustes de consentimiento de
          la aplicación.
        </p>
      </Section>

      <Section title="9. Tus derechos">
        <p>
          De acuerdo con el RGPD puedes ejercer en cualquier momento los siguientes
          derechos escribiendo a{" "}
          <a href="mailto:privacidad@colecciona.app">[email real de privacidad]</a>:
        </p>
        <ul>
          <li>Acceso a tus datos personales.</li>
          <li>Rectificación de datos inexactos o incompletos.</li>
          <li>Supresión («derecho al olvido») en los casos previstos por la ley.</li>
          <li>Limitación del tratamiento.</li>
          <li>Portabilidad de los datos.</li>
          <li>Oposición al tratamiento basado en interés legítimo.</li>
          <li>
            Retirada del consentimiento en cualquier momento, sin afectar a la
            licitud de los tratamientos anteriores.
          </li>
        </ul>
        <p>
          Tienes derecho a reclamar ante la Agencia Española de Protección de Datos
          (www.aepd.es, especialmente si consideras que hemos vulnerado tus derechos).
        </p>
      </Section>

      <Section title="10. Seguridad y notificación de brechas">
        <p>
          Aplicamos medidas técnicas y organizativas adecuadas para proteger tus
          datos frente a accesos no autorizados, pérdida o alteración. Si se produjera
          una violación de seguridad que suponga un riesgo para tus derechos y
          libertades, te lo notificaremos, y, si procede, a la autoridad de control,
          conforme al RGPD.
        </p>
      </Section>

      <Section title="11. Menores de edad">
        <p>
          El uso de la plataforma está restringido a mayores de 14 años o de la edad
          mínima exigida por la legislación aplicable. Si eres responsable legal y
          detectas un uso por parte de un menor sin autorización, contacta con
          nosotros para eliminar la cuenta y los datos asociados.
        </p>
      </Section>

      <Section title="12. Cambios y vigencia">
        <p>
          Podemos actualizar esta política cuando sea necesario.{" "}
          La fecha de última actualización es la indicada arriba. Si los cambios
          fueran sustanciales, te lo comunicaremos por los medios disponibles.
        </p>
      </Section>

      <Section title="13. Contacto y Delegado de Protección de Datos">
        <p>
          Para cualquier cuestión sobre privacidad, escríbenos a{" "}
          <a href="mailto:privacidad@colecciona.app">[email real de privacidad]</a>.
          Si hubiera obligación legal de designar un Delegado de Protección de Datos
          (DPO), lo comunicaremos públicamente en esta sección.
        </p>
      </Section>
    </LegalPage>
  );
}

function Section({ title, children }) {
  return (
    <div className={styles.section}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}